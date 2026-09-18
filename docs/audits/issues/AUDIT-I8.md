# AUDIT-I8 — Rust engine surfaces absent from this repository (scope note)

**Type:** SCOPE NOTE (not a defect of this repo) · **Severity:** P3 · **Status:** Open — track in the platform/engine repo
**Labels:** `scope`, `rust`, `audit-2026-09-18`

## 1. Problem
This repository is the **web platform demonstrator** over fixture corpora. The audit
checklist's engine phases (CLI binary behavior, daemon, SQLite/telemetry ingestion,
incremental analysis, `wanyrix doctor` runtime, p95 CLI < 150ms, etc.) have **no code
here to audit**. Verdicts for those phases are therefore **N/A (platform repo)** —
recorded so the gap is explicit rather than silently assumed.

## 2. Evidence
- `rg -l "Cargo.toml|src/main.rs|cargo" .` → only fixture strings inside `src/lib/wanyrix/data.ts` and README prose; no Rust source, no Cargo manifests, no CLI binary artifacts.
- package.json scripts contain no Rust build steps.

## 3. Current behavior / 4. Expected
Current: engine behavior is *simulated* by fixtures with contract-faithful shapes
(versioned report flavors, measured/estimated/verified labels, deterministic outputs).
Expected: the engine repo carries the real implementations; this repo pins the
contracts both sides share.

## 5. Root cause
Product split: web demonstrator here, engine elsewhere (or not yet public).

## 6. Implementation requirements
- In the engine repo: audit each phase against the same evidence standard.
- Here: extract the shared contracts (report flavors, finding schema, doctor output
  schema, gates semantics) into `docs/CONTRACTS.md` (extends AUDIT-I6) so the two repos
  cannot drift.

## 7. Acceptance criteria
- [ ] Contracts doc exists here; engine repo references it (or a mirrored copy).

## 8. Tests required
Contract fixtures in AUDIT-I4 can validate this repo's side.

## 9. Security considerations
Telemetry/daemon phases must be security-reviewed in the engine repo.

## 10. Performance considerations
CLI p95 targets belong to the engine repo.

## 11. Dependencies
AUDIT-I5 (cross-repo visibility), AUDIT-I6 (docs).

## 12. Definition of Done
Contract doc merged; engine-side tracking issue filed in that repo.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "scope: engine phases are N/A in this repo — extract shared contracts" \
  -b "See docs/audits/issues/AUDIT-I8.md" -l "scope,contracts"
```
