# TDR — Deterministic Application State

**Status:** Accepted and implemented  
**Date:** 2026-07-27  
**Issue:** [#54](https://github.com/tgoliveira11/selahkeep/issues/54)

## Decision

SelahKeep uses one server-resolved application snapshot, a synchronous account-identity boundary, vault-core owner operations and leases, centralized browser capability detection, and consumer-neutral asynchronous ownership tokens. Private async results may commit only while all ownership dimensions still match.

This is a layered state contract, not one global state machine. Account authentication remains owned by `@tgoliveira/secure-auth`; UVK/session ownership remains owned by `@tgoliveira/vault-core`; SelahKeep owns resource-specific loading, empty, error, and encrypted-data orchestration.

## State model and legal transitions

| Layer | States | Legal transitions | Fail-closed behavior |
|---|---|---|---|
| Bootstrap | `pending`, `ready(owner|null)`, `error` | `pending → ready`, `pending → error` | No authenticated/private tree before a durable owner is resolved |
| Account identity | `owner A`, `owner B`, `guest`, `partial session` | Any replacement crosses `AppBootstrapBoundary` | Hide prior tree, synchronously clear private state, invalidate vault owner, refresh server snapshot |
| Browser capability | `checking`, `supported`, `unsupported` | `checking → supported|unsupported`; explicit refresh may recheck | Do not offer PRF enrollment/unlock while unknown or unsupported |
| Vault | `locked`, `unlocking(operation)`, `unlocked(lease)`, `locked` | Only the current owner operation may install a key; a valid lease is required afterward | Lock/logout/account replacement invalidates operations, leases, keys, caches, and late commits |
| Private resource | `pending(scope)`, `ready`, `empty`, `error` | A captured request may settle only for its unchanged scope and generation | Pending is never rendered as empty; a stale settlement is discarded |

The state layers compose. For example, an authenticated account with a locked vault is valid; account session readiness never implies vault unlock.

## Server bootstrap

`resolveAppBootstrap()` resolves the non-secret first-frame snapshot before the root providers render:

- the package-owned account session;
- a fully authenticated `ownerId` (partial 2FA/email-verification sessions are not owners);
- the effective server-only `secureAuth.uiConfig`, including server-confirmed OAuth and preference capability;
- vault status and browser binding routing metadata;
- the user auto-lock preference, or an explicit `unavailable` state;
- platform-admin access.

The snapshot must never contain decrypted notes, drafts, private indexes, note keys, wrapped resource keys, attachment plaintext, voice audio, or transcripts. Durable account lookup failure is fatal. Vault-status and preference lookup failures degrade explicitly and fail closed: the UI does not infer an empty vault, and unavailable auto-lock preferences use the minimum supported timeout.

`SessionProvider` receives the same server session. Login and registration screens receive the package's server-resolved UI configuration rather than reconstructing OAuth providers from public environment variables.

## Account identity boundary

`AppBootstrapBoundary` compares the server snapshot owner with the fully authenticated client session. A mismatch (A → B, A → guest, guest → B, or a partial session) immediately replaces the subtree with the canonical loading state. In a layout effect, before the next paint, it:

1. clears decrypted note caches and registered consumer cleanup handlers;
2. invalidates the vault-core owner, outstanding operations, and leases;
3. requests a new server snapshot.

A failing cleanup handler cannot prevent the remaining fail-closed cleanup. This boundary is intentionally above all authenticated/private consumers.

## Vault operation and lease ownership

Every setup, password unlock, recovery unlock/replace, passkey enroll/unlock/remove, KDF upgrade, auto-lock, and session mutation follows the vault-core contract:

- call `beginVaultSessionOperation(ownerId)` for owner-bound mutations;
- assert the operation after awaited derivation/ceremony work and before installing or persisting key state;
- install a non-extractable in-memory UVK only through the current operation;
- capture the resulting `VaultSessionLease` for subsequent private work;
- assert that lease after every relevant `await` and before state/cache/persistence commits;
- invalidate the owner on logout or account replacement; invalidate the epoch on lock.

When vault-core recommends a password KDF upgrade after a successful unlock, SelahKeep re-wraps the same UVK in the browser, reasserts the lease, and persists only the new ciphertext through `PUT /api/vault/password-envelope`. Envelope replacement is transactionally serialized by owner and method so concurrent tabs cannot create two active successors.

SelahKeep's `vault-session.ts` remains an application adapter for cache cleanup, callbacks, and UI snapshots; vault-core is the authority for operation ordering, owner identity, epoch validity, and key-bearing leases.

## Async result ownership

`AsyncOwnershipController` provides a monotonic, consumer-neutral last-request-wins token. A token contains:

```text
ownerId + leaseEpoch + resourceId + encryptedKeyFingerprint? + generation
```

A result may update React state, decrypted caches, IndexedDB ciphertext, or server ciphertext only after the token and vault lease are both current. Starting a newer request, switching resource, changing the encrypted wrapped-key identity, locking the vault, logging out, or changing account invalidates older results. Cancellation errors are intentionally not presented as resource errors.

The fingerprint is opaque routing state only. It must never contain or log a raw key, bearer token, plaintext, or exportable key material.

## Resource behavior

The contract is applied to the highest-risk private consumers:

- vault index and encrypted settings;
- note list, detail, create/update/delete, excerpts, search bodies, and eager decrypt cache;
- encrypted local drafts and pending encrypted attachments;
- note versions and attachments;
- standalone and note-bound Kanban loading, saves, history, and bidirectional sync;
- integrations, grants, shared ciphertext, and handoff state;
- storage usage;
- passkey setup/enrollment/removal and recovery replacement;
- voice capture, worker transcription, and audio-file decode.

All routes use group-level loading boundaries. There is deliberately no root `app/loading.tsx`, because a global loading fallback could mask 404/not-found behavior. Root and segment error boundaries use the canonical Stillness loading/error patterns and design tokens.

## Offline behavior

Offline support does not copy private resource state into a global store. Encrypted drafts may remain in IndexedDB under their existing AAD and ciphertext-only policy. After lock or owner replacement, decrypted caches and UI state are removed; reconnect creates a new request generation and requires a current vault lease before decrypting or committing anything.

## Preferences API and migration

SelahKeep delegates preferences to secure-auth 0.8.0:

| Method/path | Purpose |
|---|---|
| `GET/PATCH /api/account/preferences` | Read/update a preference snapshot |
| `GET/PUT/DELETE /api/account/preferences/[key]` | Manage a namespaced preference |
| `GET /api/account/preferences/export` | Export account preferences |

Migration `0022_secure_auth_user_preferences.sql` creates the package-owned `user_preferences` table. Migration `0023_secure_auth_passkey_counter_revision.sql` adds compare-and-set revisioning for the shared WebAuthn counter. Neither stores vault key material or note plaintext.

### Rollout and backout

On 2026-07-27, `npm run db:migrate` completed against the production `DATABASE_URL` supplied by `.env.local`. A read-only metadata check confirmed the table, five expected columns, composite primary key, and namespace index. No user rows or private values were read.

The migration is additive. Application rollback may safely leave `user_preferences` in place for package compatibility. Dropping it would delete account preferences and is therefore never part of an automated backout; a destructive schema rollback requires a separately approved data-retention plan.

## Dependency baseline

The deterministic state contract is pinned to:

- `@tgoliveira/secure-auth@0.8.0`
- `@tgoliveira/vault-core@1.6.1`
- `@tgoliveira/outpost@1.2.2`
- `next@16.2.11`
- `next-auth@4.24.15`

## Enforcement and conformance

Required tests cover:

- generation, owner, epoch, resource, and encrypted-key-fingerprint replacement;
- owner A private DOM removal before owner B is rendered;
- unresolved client session hiding a server-owned tree;
- real vault lease rejection after owner invalidation;
- no plaintext/API/server boundary regressions;
- package version pins and schema readiness.

For new private async flows, reviewers must identify the owner, resource identity, vault lease (when decrypted/key-bearing), generation, cancellation point, and loading/error/empty states. `npm run validate` is the merge gate.

## Shared-enforcement decision

No application runtime is extracted in this change. Vault owner operations and leases already belong in vault-core. The app-specific bootstrap includes SelahKeep repositories, binding cookies, vault status, admin policy, and preference namespace, so moving it into secure-auth would couple the package to product concerns.

Two reusable candidates remain intentionally small:

1. an account-identity boundary contract with a consumer-provided synchronous cleanup callback, if multiple consumers prove the same lifecycle;
2. the consumer-neutral async ownership token, potentially as a standalone utility only after at least three equivalent production call sites across two applications.

Conformance rules/tests should be shared before runtime code. LiqSense comparison and follow-up are tracked independently; copying token/JWK identity or application-specific bootstrap data is explicitly rejected.
