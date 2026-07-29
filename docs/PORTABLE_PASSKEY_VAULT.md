# Portable passkey vault unlock

SelahKeep uses the trusted broker protocol from `@tgoliveira/vault-core` 1.8.1 and the independent
authorization ceremony from `@tgoliveira/secure-auth` 0.10.1. One synced account passkey may be
used for account login and portable vault authorization, but those remain separate actions.

## Security and ownership

- The browser creates the random PUK and sends it directly to the broker over TLS. It never crosses
  a SelahKeep API, URL, cookie, browser storage, log, or analytics boundary.
- Secure-auth verifies an exact-credential, user-verification-required assertion and signs a
  15–120 second, single-use ES256 grant. A login assertion never emits that grant.
- Unlock uses a fresh non-extractable, one-use P-256 browser key. The broker seals the PUK to its
  thumbprint. Vault-core validates the response, restores a non-extractable UVK, and zeroes PUK
  bytes.
- Vault-core invokes SelahKeep's secure-auth receipt verifier before committing the portable inner
  key cache or returning the UVK for session installation. A rejected receipt fails closed.
- The broker is trusted: compromise of its running service plus database and KEK can recover PUKs
  and encrypted UVK envelopes. This is an explicit availability/portability tradeoff, not a
  zero-knowledge claim against the broker.
- Password and recovery phrase envelopes remain independent and required recovery methods.

## Data and routes

Migration `0024_portable_vault_broker.sql` includes secure-auth migration `0005` verbatim in effect
and adds `vault_portable_broker_envelopes` plus `passkey_cleanup_epochs`. App mappings contain only
opaque UUID AAD scope, broker envelope ID, account credential relation, state, and timestamps.

The browser calls `${VAULT_PORTABLE_BROKER_URL}/api/v1/envelopes/{enroll,unlock,revoke}` directly.
The configured value must be one exact HTTPS origin (for example,
`https://vault-broker-green.vercel.app`) with no credentials, path, query, fragment, or wildcard.
When the portable broker feature is enabled, that validated origin alone is added to the
application CSP `connect-src`; invalid values are omitted fail-closed.
It obtains and finalizes grants through:

- `POST /api/account/passkeys/portable-vault-grants/options`
- `POST /api/account/passkeys/portable-vault-grants/verify`
- `POST /api/account/passkeys/portable-vault-grants/finalize`

The app owns mapping preparation/binding/listing under `/api/vault/portable-passkey`. Vault-core
calls the app-owned finalize route through a typed callback; the route updates local mapping state
only after secure-auth has verified and consumed the receipt.

## Deployment order

1. Apply migration `0024` while both portable and legacy enrollment are off.
2. Configure distinct Production and Preview keys, issuers, broker registrations, databases, and
   opaque subject keys. Do not reuse any key across environments.
3. Keep `VAULT_LEGACY_PASSKEY_PRF_ENROLLMENT_ENABLED=false`.
4. Enable `VAULT_PORTABLE_BROKER_ENABLED=true`, deploy, and complete browser acceptance tests.
5. Keep legacy reads available during dual-run. Do not execute cleanup until the recorded counts
   and owner-approved maintenance window are ready.

## Legacy cleanup runbook

Freeze all passkey enrollment first. Record an epoch with operator-supplied exact counts:

```bash
npm run passkeys:cleanup -- --prepare-epoch --expected-counts '<exact-json>'
```

Inspect repeatedly without mutation:

```bash
npm run passkeys:cleanup -- --epoch-id '<uuid>' --expected-counts '<exact-json>'
```

Only after owner approval, execute with the same epoch and counts:

```bash
npm run passkeys:cleanup -- --execute --epoch-id '<uuid>' --expected-counts '<exact-json>'
```

The transaction aborts on any count drift or any portable mapping targeting an old
credential. It preserves credentials created after the cutoff. Audits are retained while their
legacy `credentialId` metadata field is removed. Rate-limit buckets are intentionally untouched
because they lack immutable creation scope. After postconditions and browser acceptance pass, mark
the epoch reopened:

```bash
npm run passkeys:cleanup -- --reopen-epoch --epoch-id '<uuid>'
```

Never run `--execute` merely to discover counts. The default epoch command is dry-run.
