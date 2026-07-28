# Threat Model — SelahKeep MVP

> **Filename note:** `THREAT_MODEL_Private_Letters_Vault.md` is retained for link stability. Content below describes **SelahKeep** (notes + vault domain). Historical “private letters” wording refers to encrypted note content types (prayers, reflections), not an active `letters` implementation.

## Document Status

| Field | Value |
|-------|-------|
| **Status** | Draft — P1 beta gate |
| **Scope** | SelahKeep MVP (web) — encrypted notes in a private vault |
| **Related docs** | [TDR](./TDR_LTG_Vault_MVP.md), [ADR-005](./ADR-005_LTG_Vault_Cryptography_Argon2id_Recovery_Phrase_Note_Keys.md), [ADR-006](./archive/ADR-006_LTG_Vault_Passkey_PRF_Unlock.md), [SECURITY.md](../SECURITY.md) |
| **Audience** | Engineering, security review, product, legal/privacy |

## Security Architecture Summary

SelahKeep uses **client-side encryption**. Note title, body, categories, and tags are encrypted in the browser before any API request. The server stores only structured encrypted payloads (AES-GCM with AAD binding per ADR-005). The User Vault Key and Note Keys never leave the client in plaintext.

**Core privacy promise:** the operations team does not hold keys required to read private note content from database records alone.

**Residual truth:** any attacker who can execute JavaScript in an unlocked vault session on the user's device can decrypt notes. Client-side encryption protects data at rest on the server; it does not eliminate endpoint compromise. Because the app is delivered by the server on each load, a compromised server could also serve key-stealing JS — CSP/HSTS reduce but do not eliminate this web-delivery trust assumption (a native app would not have it).

**Metadata visible to the server (not content):** even with perfect E2EE, the server can observe per-user note counts, client-generated note/version UUIDs, created/updated timestamps, version counts/timestamps, encrypted-payload **sizes**, and safe vault security events (unlock method + time). Title, body, category, tag names, and answered status are encrypted. The privacy promise covers **content**, not the existence/volume/timing of notes.

### Implemented controls (cross-cutting)

| Control | Implementation |
|---------|----------------|
| Client-side encryption | `src/lib/crypto-client/` — AES-GCM, per-note keys, AAD binding |
| No plaintext on server | Plaintext rejection policy, Zod schemas, sentinel tests |
| Account deletion | `DELETE /api/account` cascades user-owned rows via FK `onDelete: "cascade"` |
| Audit logging | Sanitized metadata only; no note content or key material |
| Rate limiting | `RATE_LIMIT_STORE=postgres` in production (PostgreSQL adapter); in-memory for local dev |
| Vault auto-lock | 15-minute inactivity timeout (`VAULT_INACTIVITY_MS`) |
| Autosave | **Disabled for MVP** — no autosave implementation; plaintext autosave forbidden |
| Vault unlock methods | Password, recovery phrase, passkey PRF only (`docs/TRUSTED_DEVICES_REMOVAL.md`) |
| IndexedDB | Legacy trusted-device stores purged on DB v3 upgrade; no vault unlock material persisted |
| CSP | Nonce-based, production `script-src 'self' 'nonce' 'strict-dynamic' 'wasm-unsafe-eval'`; `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `worker-src 'self' blob:`; no third-party **scripts**. `connect-src` is `'self'` plus the (self-hostable) on-device voice model host(s) only — see `src/lib/security/content-security-policy.ts` |
| Transport / headers | `Strict-Transport-Security` (HSTS, 2y, preload), `Permissions-Policy` (`microphone=(self)`, camera/geolocation/payment/usb off), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` — `next.config.ts` |
| Note version history | Immutable encrypted snapshots in `note_versions`; client-encrypted under the note's Note Key, AAD-bound to a unique `versionId`; retention-pruned server-side on row counts only; cascade-deletes with the note (`docs/TDR_Note_Version_History.md`) |
| Voice notes | On-device transcription (Whisper/transformers.js in a Web Worker); microphone audio and transcript never leave the device; only model weights are fetched (self-hostable); guard test `voice-no-content-egress.test.ts` (`docs/TDR_Local_Voice_Notes.md`) |
| Account 2FA (TOTP) | Optional sign-in protection for email/password, OAuth, and passkey sign-in; secrets encrypted at rest (`TWO_FACTOR_SECRET_ENCRYPTION_KEY`); backup codes hashed; partial sessions never run the vault hook; separate from vault crypto |
| Passkey account sign-in | WebAuthn `login` challenges; issues `login-token` session; vault unlock only with PRF envelope client-side; sign-in-only passkeys must not be shown as vault recovery |
| Email verification & password reset | Hashed opaque tokens in `account_tokens`; single-use atomic consumption; generic forgot-password response; rate limits; no vault key or letter content in emails; password reset/change does not unlock vault |
| Email delivery (SMTP) | Nodemailer SMTP relay; console provider dev-only; SMTP logs domain/subject only; credentials in env; Mailpit for local capture; production must not use `EMAIL_PROVIDER=console` |
| Session invalidation on password change | `password_updated_at` compared to JWT `iat`; sessions issued before update invalidated |
| Account session management | Server-side `account_sessions` with JWT `sid`; revocation enforced in JWT callback; masked IP display; sessions ≠ vault unlock |

**Historical:** Trusted devices were removed from the product. See `docs/TRUSTED_DEVICES_REMOVAL.md`.

---

## Threat Catalog

Each entry follows: **Description → Impact → Current mitigations → Remaining risk → Required follow-up**.

---

### 1. Database leak

**Description**  
An attacker obtains a copy of the PostgreSQL database (SQL injection, misconfigured backup, stolen credentials, insider export, cloud provider incident).

**Impact**  
Exposure of encrypted letter payloads, vault envelopes, recovery envelopes (KDF metadata + ciphertext), trusted-device metadata, passkey public keys, audit events, and account emails. Without key material, ciphertext should remain confidential.

**Current mitigations**

- Private letter title/body encrypted on client before persistence; server never stores plaintext.
- Letter Key wrapped by User Vault Key; User Vault Key wrapped in vault envelopes only.
- Recovery codes never stored — only KDF-derived envelope ciphertext. New `password` and `recovery_phrase` envelopes are **Argon2id-only** (no PBKDF2 downgrade, per ADR-005); PBKDF2-SHA-256 appears only in legacy `recovery_code` (vault-v1) envelopes.
- AAD binds ciphertext to `userId`, `resourceId`, and `field` — limits cross-user/cross-resource misuse.
- Database access restricted to application service account; no admin UI for letter content.
- Sentinel phrase tests verify plaintext never reaches storage layers.

**Remaining risk**

- Encrypted blobs remain offline-attackable if envelope keys are eventually obtained (stolen device, recovery brute force, future key compromise).
- Metadata leakage: email addresses, letter timestamps, answered status, device names, audit event types.
- A future implementation bug could persist plaintext despite policies.

**Required follow-up**

- External security review of schema and repository queries before production beta.
- Verify production database credentials, network isolation, and encryption-at-rest settings with hosting provider.
- Document metadata sensitivity in privacy policy.
- Periodic sentinel and plaintext-rejection regression tests in CI.

---

### 2. Malicious admin

**Description**  
A privileged operator (employee, contractor, compromised admin account) attempts to read user private letters or extract keys from production systems.

**Impact**  
Reputation destruction, regulatory exposure (LGPD), loss of user trust. Direct letter disclosure if combined with another attack (e.g., live session hijack, compromised deploy). Database alone should not suffice.

**Current mitigations**

- Architecture forbids admin access to private note content (TDR, ADR-005, AGENTS.md).
- No server-side decryption path for letter title/body.
- No admin API returning encrypted letter payloads for support workflows.
- Audit events record security actions without sensitive content.
- Agent/developer rules prohibit plaintext persistence shortcuts.

**Remaining risk**

- Admin can still access infrastructure: deploy malicious frontend, read logs if misconfigured, export database, reset user sessions, or disable security controls.
- Insider threat is not cryptographically prevented — it is procedurally and architecturally discouraged.

**Required follow-up**

- Production access controls: least privilege, MFA, break-glass procedures, deployment approvals for vault/letter paths.
- Separate staging/production credentials and databases.
- Log access restricted and monitored.
- Incident response playbook before real-user beta.

---

### 3. Compromised frontend deploy

**Description**  
An attacker replaces or tampers with the deployed Next.js frontend bundle (stolen deploy token, compromised CI secret, supply-chain artifact substitution).

**Impact**  
**Critical.** Malicious JavaScript can exfiltrate plaintext during read/write, steal unlocked User Vault Key from memory, replace crypto routines with pass-through "encryption," or log keystrokes. Equivalent to full vault compromise for affected users.

**Current mitigations**

- HTTPS-only delivery.
- Production CSP: `script-src 'self'` — blocks injected external scripts (does not block malicious `'self'` bundle).
- No third-party scripts on letter-writing or letter-reading pages (TDR §16).
- Crypto logic isolated in `src/lib/crypto-client/` with security tests and agent rules.
- Build reproducibility via lockfile (`npm ci`) and CI lint/test/coverage gates.

**Remaining risk**

- A malicious `'self'` script is fully trusted by the browser. CSP cannot distinguish good vs. bad first-party code.
- Users who load the app during the compromise window may be affected until redeploy.

**Required follow-up**

- Deployment approval workflow for production; protected branch and signed commits policy.
- Deploy token rotation and scoped permissions (Vercel/hosting).
- Subresource Integrity or deploy-hash verification where platform supports it.
- Post-deploy smoke tests including crypto sentinel checks.
- User communication plan for frontend integrity incidents.

---

### 4. Cross-site scripting (XSS)

**Description**  
An attacker injects script that runs in the application's origin (stored or reflected XSS in UI, markdown rendering, error pages, or compromised dependencies).

**Impact**  
While the vault is unlocked, injected script can invoke Web Crypto, read DOM form fields, intercept API calls, and exfiltrate plaintext letters and keys. Session cookie theft enables account-level actions but not server-side decryption without client keys.

**Current mitigations**

- Strict production CSP (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`).
- No inline scripts in production builds.
- React default escaping for rendered content.
- Plaintext letter fields never echoed from server responses.
- Vault auto-lock after **15 minutes** of inactivity reduces exposure window.
- Sign-out clears IndexedDB vault state (`clearVaultClientState()`).

**Remaining risk**

- XSS on this origin is treated as **vault compromise** for any active unlocked session.
- CSP `'unsafe-inline'` on styles is acceptable for styling but does not mitigate script XSS.
- Development CSP relaxations (`unsafe-eval`) do not apply to production.

**Required follow-up**

- Security review of all user-controlled render paths before beta.
- DOMPurify or equivalent if rich text is ever introduced.
- Bug bounty or external pen test focused on vault pages.

---

### 5. Stolen device

**Description**  
An attacker gains physical access to a user's unlocked or lockable device with an active vault session or cached trusted-device material in IndexedDB.

**Impact**  
Decryption of all letters while vault is unlocked. If device is registered and not revoked, attacker may unlock vault offline using cached envelope (see offline revocation limitation). Potential account actions if session is active.

**Current mitigations**

- User Vault Key held in session memory only while unlocked; cleared on auto-lock (15 min inactivity).
- IndexedDB stores encrypted vault envelope and non-extractable device `CryptoKey` — not plaintext keys.
- Trusted device revocation invalidates server envelope; online unlock checks device status.
- Sign-out wipes local vault client state.
- Passkeys (where supported) add device-bound authentication layer.

**Remaining risk**

- Unlocked session + physical access = full access until auto-lock or sign-out.
- **Offline limitation:** revoked device may still decrypt from cached IndexedDB until next successful online revocation check.
- **Offline usability trade-off:** When the app is offline and the current device has valid local vault material, local unlock may be allowed. The device revocation status will be verified again when the app reconnects. This does not override online revocation checks. The UI shows a discreet notice when unlock proceeds without an online device-status verification.
- Screen capture, OS-level keyloggers, and forensic disk imaging are out of app scope.

**Required follow-up**

- User-facing guidance: sign out on shared devices, revoke lost devices promptly, use OS disk encryption.
- Consider shorter auto-lock option post-MVP.
- Evaluate periodic background revocation polling when vault is open.

---

### 6. Lost recovery code

**Description**  
User loses their recovery code and all other recovery methods (trusted devices, passkeys).

**Impact**  
**Permanent loss of access** to encrypted letters. By design, the service cannot recover plaintext content.

**Current mitigations**

- Recovery code shown only at generation/regeneration; never stored server-side.
- UX prompts encourage recovery phrase setup after vault creation (ADR-005).
- Recovery state classification (Protected / Basic / At Risk) encourages multiple methods.
- Passkeys and multiple trusted devices provide alternate paths.

**Remaining risk**

- User may postpone recovery setup and lose single device.
- No social recovery or operator-assisted key recovery in MVP.

**Required follow-up**

- Clear privacy-policy language: user responsibility for recovery methods.
- UI copy review before beta.
- Optional: recovery code download/print flow usability testing.

---

### 7. Phishing

**Description**  
Attacker tricks user into entering credentials, recovery code, or unlocking vault on a fake site mimicking SelahKeep.

**Impact**  
Account takeover, recovery code capture, or plaintext exfiltration if user decrypts on attacker-controlled page.

**Current mitigations**

- WebAuthn/passkeys resist phishing when used (origin-bound).
- Recovery code entry only on authentic origin with client-side KDF — phishing site would need to mimic full app flow.
- OAuth (Google, Apple, Microsoft) uses provider consent screens.
- No email links embedding secrets.

**Remaining risk**

- Email/password users can be phished for credentials.
- Recovery code typed into a convincing clone is fully compromising.
- MFA not required for all auth paths in MVP.

**Required follow-up**

- Publish official domain list and anti-phishing user education.
- Consider encouraging passkeys over password where possible.
- DMARC/SPF for transactional email before production.
- Monitor for typosquat domains.

---

### 8. Account takeover

**Description**  
Attacker obtains valid session or credentials (phishing, credential stuffing, OAuth token theft, session fixation).

**Impact**  
Attacker can read/modify/delete encrypted letter **metadata**, revoke devices, trigger account deletion, and attempt vault unlock if client key material exists on attacker's device. Cannot decrypt letters from server API alone without vault unlock material.

**Current mitigations**

- Rate limiting on login, registration, recovery, passkey, and account deletion (`RATE_LIMIT_STORE=postgres` in production).
- Failed unlock attempts audited without sensitive metadata.
- Server stores ciphertext only — takeover does not directly yield plaintext.
- Account deletion cascades user data from active storage.
- HTTPS and secure session cookies (NextAuth).

**Remaining risk**

- Attacker with session + user's unlocked browser profile has full access.
- Password reuse across sites enables credential stuffing.
- No step-up authentication for sensitive actions (device revoke, account delete) beyond session.

**Required follow-up**

- Review NextAuth session hardening (rotation, secure cookie flags).
- Consider re-authentication before account deletion and recovery regeneration.
- Alert users on new device login (post-MVP).

---

### 9. Malicious browser extension

**Description**  
User installs a compromised or overly-permissive browser extension with access to page content, DOM, or network on the vault origin.

**Impact**  
Comparable to XSS while vault is unlocked: extensions can read form fields, patch `fetch`, and access in-memory keys. Some extensions operate with elevated privileges beyond CSP.

**Current mitigations**

- CSP reduces drive-by injection but **does not block extensions**.
- Minimal sensitive data in DOM when possible; encryption before API send.
- Auto-lock limits window of exposure.

**Remaining risk**

- **High** for users who combine extensions with vault usage. Not fully mitigatable in-browser.

**Required follow-up**

- User education: avoid untrusted extensions on vault origin; use dedicated browser profile.
- Document in SECURITY.md and privacy FAQ.
- No technical silver bullet without native app or isolated browser context.

---

### 10. Third-party script compromise

**Description**  
A third-party library loaded on vault pages (analytics, error tracking, A/B testing, chat widget) is compromised or misconfigured to exfiltrate data.

**Impact**  
Script runs with page privileges; can harvest plaintext during entry/decryption if present on letter screens.

**Current mitigations**

- **No third-party scripts** on letter-writing or letter-reading pages (TDR §16).
- Production CSP `script-src 'self'`.
- Analytics and session replay disabled on private letter screens (TDR operations guidance).
- Error tracking must strip request/response bodies (SECURITY.md).

**Remaining risk**

- Accidental addition of third-party script during marketing/feature work.
- Error tracking on vault routes if misconfigured.

**Required follow-up**

- Code review gate blocking third-party loads on `(vault)` routes.
- Automated CSP compliance test (existing security test for production headers).
- Vendor assessment before any future third-party on authenticated pages.

---

### 11. Compromised OAuth account

**Description**  
Attacker compromises user's Google, Apple, or Microsoft account and uses OAuth login to access SelahKeep.

**Impact**  
Full account access at application layer. Attacker still needs vault unlock on a new device unless victim's browser session/device is also compromised.

**Current mitigations**

- OAuth provider authentication separate from vault unlock.
- Vault envelopes require trusted device, passkey, or recovery code on new environments.
- Trusted device registration requires client-side key ceremony — not automatic from OAuth alone.

**Remaining risk**

- Attacker with OAuth + access to victim's unlocked trusted device gets full letter access.
- Attacker can delete account and letters from active storage.
- OAuth provider session may outlive local vault lock.

**Required follow-up**

- Recommend users secure Google/Apple/Microsoft accounts (2FA).
- Microsoft sign-in uses minimal OIDC scopes only; no automatic cross-provider account linking.
- Consider notifying user on login from new IP/device.
- Document OAuth + vault independence in user-facing security FAQ.

---

### 12. Backup exposure

**Description**  
Database backups (provider snapshots, manual dumps, replicated replicas) are leaked, misconfigured as public, or retained after account deletion.

**Impact**  
Encrypted letter content and envelopes persist in backup media. Attacker with backup + future key compromise could decrypt historical data. Metadata and account emails also exposed.

**Current mitigations**

- Active storage holds only encrypted private letter content.
- Design requirement: backups must not contain plaintext letters (TDR §24).
- Account deletion removes data from **active** database via cascade.
- See [BACKUP_RESTORE_POLICY.md](./BACKUP_RESTORE_POLICY.md) for draft retention/deletion posture.

**Remaining risk**

- **Deletion from all backup tiers is not yet verified or guaranteed.**
- Provider default snapshot retention may exceed account deletion window.
- Restore drills not yet completed.

**Required follow-up**

- Finalize backup/restore policy before real-user beta.
- Verify provider backup encryption, access ACLs, and retention with hosting vendor.
- Define and test deletion propagation expectations.
- Document honest user-facing limitations.

---

### 13. Logging misconfiguration

**Description**  
Application, proxy, or error-tracking logs capture request bodies, decrypted client errors, recovery attempts, or session artifacts.

**Impact**  
Plaintext letters or keys in log aggregators; long-lived sensitive data in third-party observability tools.

**Current mitigations**

- Policy: never log plaintext title/body, User Vault Key, Letter Key, recovery code, decrypted payloads.
- Audit metadata sanitized via allowlist (`sanitizeAuditMetadata`).
- Sentinel phrase tests across API, services, and runtime integration.
- Logger redaction tests in security suite.

**Remaining risk**

- Misconfigured debug logging in staging/production.
- Error tracking SDK capturing form state if enabled on vault pages.
- Infrastructure logs (load balancer) may capture unusually large payloads if misused.

**Required follow-up**

- Production log redaction validation before beta (TDR §37).
- Disable verbose HTTP body logging on all environments handling vault APIs.
- Error tracking config review with payload scrubbing rules.
- Periodic sentinel audits on log sinks.

---

### 14. Supply chain attack

**Description**  
A compromised npm dependency introduces malicious code into the build (typosquat, maintainer takeover, install scripts).

**Impact**  
Ranges from build-time secret theft to runtime backdoor in production bundle — equivalent to compromised deploy for affected versions.

**Current mitigations**

- Lockfile (`package-lock.json`) with `npm ci` in CI and agent workflow.
- Lint, test, coverage (≥90%), and build gates on every change.
- AGENTS.md forbids mock crypto and security shortcuts.
- Minimal dependency surface; Web Crypto native APIs preferred.

**Remaining risk**

- No automated dependency pinning beyond lockfile review.
- Transitive dependency compromise may evade casual review.
- AI-suggested packages may introduce risky deps.

**Required follow-up**

- Enable Dependabot or equivalent; define update cadence.
- `npm audit` policy for production releases.
- Optional: SBOM generation and signed releases.
- Security review for any new crypto-related dependency.

---

### 15. Compromised build pipeline

**Description**  
Attacker compromises CI/CD (GitHub Actions, Vercel integration) to inject malicious build steps or exfiltrate secrets (`NEXTAUTH_SECRET`, database URLs, deploy tokens).

**Impact**  
Malicious artifacts deployed to production; credential theft enabling database access and session forgery.

**Current mitigations**

- CI runs lint, tests, coverage, and build before merge.
- Secrets stored in platform secret managers (not in repo).
- `.env.example` documents placeholders only — no production secrets committed.

**Remaining risk**

- Compromised pipeline bypasses local developer intent entirely.
- Fork PR workflows if misconfigured could leak secrets.

**Required follow-up**

- Harden CI: OIDC deploy, environment protection rules, restricted secrets to protected branches.
- Separate CI secrets per environment.
- Audit CI configuration before beta.
- Incident response for credential rotation.

---

### 16. Malicious or mistaken AI-agent-generated code

**Description**  
An AI coding agent (or hurried human) introduces plaintext persistence, weak crypto, fake passkey flows, exportable device secrets, or bypasses validation — as explicitly forbidden in AGENTS.md.

**Impact**  
Silent destruction of privacy promise; plaintext in database, logs, or browser storage; fake security UX.

**Current mitigations**

- AGENTS.md core rule: never implement backend paths receiving plaintext letter title/body.
- Forbidden patterns documented (Server Actions for letters, localStorage keys, mock encryption).
- Sentinel phrase regression tests (`SENTINEL-PRIVATE-LETTER-DO-NOT-STORE-PLAINTEXT-12345`).
- Security test layer (`src/test/security/`).
- `TODO_SECURITY_REVIEW_REQUIRED` stop condition for uncertain crypto.
- Code review and CI gates required on every change.

**Remaining risk**

- Agent or developer override without running tests.
- Subtle crypto mistakes (nonce reuse, AAD omission) not caught by sentinel alone.

**Required follow-up**

- Mandatory human review for crypto-client and vault-unlock changes.
- Expand security tests for new API routes and envelope methods.
- Pre-beta external crypto review (ADR-005 security review gate).

---

### 17. Compromised browser, device, or OS

**Description**  
Malware, rootkit, compromised OS update channel, or untrusted corporate MDM on the user's machine intercepts input, memory, or TLS.

**Impact**  
Full compromise of anything the user can access while vault is unlocked. Keyloggers capture recovery codes and passwords. Memory scrapers capture User Vault Key.

**Current mitigations**

- Client-side encryption ensures server/database leaks alone are insufficient.
- Non-extractable `CryptoKey` for device secret reduces casual export (not immune to OS-level access).
- Auto-lock and sign-out reduce persistence window.
- Passkeys use secure hardware where available.

**Remaining risk**

- **Out of application threat model scope** for complete mitigation.
- Assumes user's endpoint integrity — standard limitation of web-based E2E encryption.

**Required follow-up**

- Document user responsibilities (OS updates, antivirus discretion, trusted networks).
- Do not over-promise protection against endpoint malware in marketing copy.
- Future native apps may leverage platform secure enclaves — out of MVP scope.

---

### 18. Offline attack against recovery envelopes

**Description**  
Attacker obtains a copy of the `recovery_code` vault envelope (from database leak, backup, or forensic export) and performs offline password guessing against the KDF-wrapped User Vault Key.

**Impact**  
If recovery code is weak or KDF parameters are insufficient, attacker derives wrapping key and decrypts all user letters.

**Current mitigations**

- Recovery codes: ≥128 bits entropy (uniform word selection + rejection sampling).
- Recovery code never stored server-side — only shown at generation/regeneration.
- KDF: **Argon2id-only** for new `password`/`recovery_phrase` envelopes (64 MiB / 3 / 1, versioned `kdf-v1`; no PBKDF2 downgrade per ADR-005). PBKDF2-SHA-256 (600k) persists only in legacy `recovery_code` (vault-v1) envelopes.
- Rate limiting on online unlock attempts (`recovery.attempt`: 5 per 15 minutes) — does not affect offline attacks on stolen blobs.
- Envelope ciphertext uses AES-GCM with AAD binding.

**Remaining risk**

- Offline attacks are unlimited by rate limits once envelope is obtained.
- User who writes down a weak custom mnemonic instead of generated code increases risk.
- KDF parameter aging — future hardware may reduce Argon2id/PBKDF2 cost over years.

**Required follow-up**

- External security review of Argon2id KDF parameters and recovery phrase entropy before production (ADR-005 gate).
- Document offline attack model in SECURITY.md.
- Plan encryption version migration path for KDF upgrades (TDR §25 key rotation — future).
- User education: treat recovery code like a master password; store offline securely.

---

## Threat Model Maintenance

| Trigger | Action |
|---------|--------|
| New API route or envelope method | Update this document and ADR-005 |
| New third-party integration | Re-assess threats 3, 9, 10, 13 |
| Backup provider change | Re-assess threats 1, 12 |
| Auth method change | Re-assess threats 7, 8, 11 |
| Pre-beta gate | External security review sign-off |

**Next review:** before any public or private beta involving real users (TDR §26, §37).
