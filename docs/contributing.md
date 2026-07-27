# Contributing — SelahKeep

Conservative workflow for humans and AI agents: **branch-first**, **merge via PR**, **manual releases only**.

| Topic | Document |
|-------|----------|
| Branch naming, commits, PR checklist | This file |
| Version releases (manual) | [releasing.md](./releasing.md) |
| GitHub branch protection | [repo-settings.md](./repo-settings.md) |
| Shipped routes, APIs, features | [CURRENT_PRODUCT_SURFACE.md](./CURRENT_PRODUCT_SURFACE.md) |
| Agent guardrails | [AGENTS.md](../AGENTS.md), `.cursor/rules/branch-pr-release.mdc` |

**Repository:** `tgoliveira11/selahkeep` · **Product:** SelahKeep · **Default branch:** `main`

---

## 1. Branch-first workflow

- **Base branch:** `main` (no `develop`).
- Create a branch from `main` before substantive work:

| Prefix | Use for |
|--------|---------|
| `feature/` | Behavior, API, UX |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `chore/` | CI, tooling, dependencies, release plumbing |

**Rules**

- Do **not** commit directly to `main` unless the maintainer explicitly asks.
- Do **not** push to `main` without explicit maintainer approval.
- Never use destructive git commands (`push --force`, `reset --hard`, etc.) unless explicitly requested.
- Commits only when the maintainer asks — otherwise leave work uncommitted or on a branch.

---

## 2. Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(api): add note version compare endpoint
fix(voice): reduce WASM heap on iOS
docs: document release workflow
chore(ci): add branch-name check
```

- Subject: clear and concise.
- Body: only when it adds context (why, not a file list).

---

## 3. Pre-PR checklist (code changes)

Before opening a PR or declaring a task done:

```bash
npm run validate
```

(`lint` → `typecheck` → `test:coverage` → `build`; see `package.json`.)

Also:

- [ ] Add or update tests for changed behavior.
- [ ] Update `CHANGELOG.md` under `## [Unreleased]` for behavior, API, schema, env vars, jobs, privacy, or visible UX changes.
- [ ] Update `docs/CURRENT_PRODUCT_SURFACE.md` when routes, endpoints, jobs, integrations, or shipped/planned status changes.
- [ ] Confirm no secrets (`.env`, credentials) are staged.
- [ ] For private async changes, add ownership/conformance coverage for owner, vault epoch, resource identity, request generation, cancellation, and pending/error/empty behavior (see `TDR_DETERMINISTIC_APPLICATION_STATE.md`).

Trivial docs-only changes may skip `npm run validate`.

---

## 4. Pull request cycle

1. Push your branch and open a PR against `main` with `gh pr create` **only when asked**.
2. Include a **summary** and **test plan**.
3. Do **not** merge, approve, or push to `main` without explicit maintainer approval.
4. Prefer **squash merge**.
5. Address review feedback on the same branch.
6. After merge: `git checkout main && git pull`, delete the merged local branch, confirm changelog/surface/tests before closing.

CI required checks (when branch protection is enabled): **`lint`**, **`typecheck`**, **`test`**, **`build`**, and **`branch-name`** (PRs).

---

## 5. Changelog

- Work in progress → `CHANGELOG.md` → `## [Unreleased]`.
- Group under `Added`, `Changed`, `Fixed`, `Security`, `Removed`.
- New releases are cut from `[Unreleased]` by the manual release workflow (see [releasing.md](./releasing.md)).
- Never log secrets, credentials, or decrypted content.

---

## 6. Releases

SelahKeep is **not** published to npm. A release is:

> `package.json` version `X.Y.Z` ⟺ git tag `vX.Y.Z` ⟺ GitHub Release `vX.Y.Z`

- Releases are **manual only** (`workflow_dispatch`).
- Agents must **not** run the release workflow or create tags/releases without explicit instruction.
- Deploy (e.g. Vercel) is separate and manual.

Details: [releasing.md](./releasing.md).

---

## 7. Documentation map (when you change…)

| Change | Update |
|--------|--------|
| Setup, commands, env | `README.md` |
| Architecture / data flow | `ARCHITECTURE.md`, `docs/MODULE_BOUNDARIES.md` |
| Crypto, vault, passkeys | `SECURITY.md`, ADRs |
| API routes | `docs/API_REFERENCE.md`, `docs/CURRENT_PRODUCT_SURFACE.md` |
| Agent workflow | `AGENTS.md`, `.cursor/rules/` |
