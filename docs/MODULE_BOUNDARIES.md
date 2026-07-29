# Module Boundaries — SelahKeep

**Status:** Phases 0–5 complete. Active domain: **notes + vault**.

This project uses a **modular monolith** under `src/modules/`. See also `docs/UTILITY_EXTRACTION_INVENTORY.md`.

## Modules

| Module | Responsibility |
|--------|----------------|
| `vault` | User Vault Key, explicit unlock (password, recovery phrase, portable passkey), recovery code/PRF envelopes (legacy reads) |
| `notes` | Encrypted note CRUD (metadata, body, per-note keys) |
| `email` | SMTP/console provider core (account emails via `@tgoliveira/secure-auth`) |
| `audit` | Audit events, persistence, sanitization |
| `rate-limit` | Rate limit adapters and policies |
| `security` | Logger/redaction, plaintext rejection, AAD policies |
| `integrations` | User MCP integrations, scoped grants, Bearer token auth for `/api/integrations/mcp/*` |
| `ui` | Domain-neutral primitives only |

**Account authentication** (login, register, OAuth, 2FA, sessions, account passkeys, password flows) is **not** a local module — see `src/lib/secure-auth.ts` and [`docs/AUTH_RESET_TO_SECURE_AUTH.md`](./AUTH_RESET_TO_SECURE_AUTH.md).

Application-state orchestration is also a boundary, not a new domain module. `src/lib/app-bootstrap.ts` may compose server-only package/services data into a non-secret snapshot. `src/lib/application-state/` may contain consumer-neutral ownership and synchronous cleanup utilities, but it must not decrypt content, access repositories, or absorb product resource state. UI consumers combine those tokens with vault-core leases as specified in [`TDR_DETERMINISTIC_APPLICATION_STATE.md`](./TDR_DETERMINISTIC_APPLICATION_STATE.md).

## Critical distinctions

```text
account authentication ≠ vault decryption
account sessions ≠ vault unlock
TOTP ≠ vault recovery
password reset ≠ vault recovery
passkey account login ≠ portable vault grant ≠ vault session installation
```

## Allowed dependency direction

```text
ui, security, email, audit, rate-limit
  -> vault, notes (product)
```

Product modules may use `src/lib/crypto-client` (notes) and `src/modules/vault` (vault unlock/setup via `@tgoliveira/vault-core`). They must not import `@tgoliveira/secure-auth/server`.

## Forbidden (enforced in tests)

- Reintroducing `src/modules/letters` or `/api/letters`
- `ui` importing database clients or product note plaintext paths
- Competing local auth modules (`src/modules/auth`, etc.)
- Utility modules importing note plaintext handling outside crypto-client

## Reusable vs product-specific

**Internally reusable:** email, audit, rate-limit, security, ui utilities

**Product-specific:** `@tgoliveira/vault-core` integration (`src/modules/vault/`), notes crypto, SelahKeep copy, encrypted vault index

## Legacy import paths

Shims under `src/server/services` and `src/lib/*` re-export from `src/modules/*` where applicable. New code should prefer `@/modules/*` public APIs.

## Historical modularization ADR

Modularization strategy is reflected in this document and `ARCHITECTURE.md` (historical ADR-004 removed from the repo).
