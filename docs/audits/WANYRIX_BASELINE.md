# WANYRIX BASELINE — Full Product Audit (Phase 0)

> Audit date: 2026-09-17 · Auditor: automated full-product audit session
> Scope statement: **this repository hosts the Wanyrix web platform only**
> (Next.js 16 demonstrator over a fixture Rust workspace). The Rust product
> core (CLI, daemon, engine, collectors, W-EIR persistence, experiment runner)
> is NOT in this repository and is audited as product-level status, not as
> code present here.

## Environment

| Field | Value |
| --- | --- |
| Repository | `Roy-Wanyoike/wanyrix` (renamed from `Ferrix` 2026-09-17, admin API) |
| Commit SHA | `4733c3692a0e78c0ff9649567a98542922ca1812` |
| Branch | `main` |
| OS / Arch | Linux x86_64 (sandbox) |
| Node | v24.21.0 |
| Bun (pkg manager) | 1.3.14 |
| Next.js | ^16.1.1 (App Router) |
| React | ^19.0.0 |
| TypeScript | 5.x strict |
| Tailwind | 4 · shadcn/ui (New York) |
| Prisma | ^6.11.1 · SQLite (`db/custom.db`) |
| Rust / Cargo | **not installed in this repo** — no Rust code exists here |
| Docker / infra | none in repo |
| Wanyrix version (web demo) | v0.4.2 (displayed by app shell) |

## Git history scan (Rule 3)

- 10 rounds of feature work landed as merged PRs #10–#48 (25 PRs total, all
  merged, 0 open) plus direct scaffold commits.
- **0 real GitHub issues exist** in the repository (verified via API
  `GET /repos/Roy-Wanyoike/wanyrix/issues?state=all` → 25 items, all PRs).
  The in-app "Issues & PRs" board's `FER-*`→`WAN-*` rows reference GitHub
  issue numbers #1–#44 that do **not** exist upstream → finding AUD-DOC-01.
- The Ferrix → Wanyrix identity migration landed in `4733c36` (145 files,
  +757/−365) and the GitHub-side rename completed in this audit session.

## Test/verification tooling present

- `bun run lint` (ESLint 9, Next.js rules) — passes with 0 errors
- `scripts/check-branding.sh` — brand gate (PASS)
- No unit/integration/E2E test suite in the repo → finding AUD-TEST-01

## Audit phases applicability

| Audit phase | Applies here | Notes |
| --- | --- | --- |
| Phase 27 Frontend | **yes — primary** | every screen audited in browser |
| Phase 22 Security | **yes** | secrets/deps/transmission/AI data flow |
| Phase 23 Performance | **yes (web subset)** | page/API latency measured |
| Phase 29 Documentation | **yes** | README vs reality |
| Phase 31 DX | **partial** | clean-run reproducibility of the demo |
| Phases 5–26 (Rust product) | **product-level only** | W-EIR, collectors, daemon, CLI, fixtures, perf budgets, soak — not in this repo; recorded as platform status with issues |
