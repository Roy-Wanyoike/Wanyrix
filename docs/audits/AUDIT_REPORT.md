# Wanyrix Post-Rename Engineering Audit — Final Report

**Audit ID:** AUDIT-2026-09-18 · **Baseline commit:** `e06866a` · **Evidence standard:** CODE + INTEGRATION + TEST + RUNTIME VERIFICATION + DOCUMENTATION. `HTTP 200` alone never counts.
**Companion docs:** `WANYRIX_BASELINE.md` (Phase 0) · `issues/ISSUE_REGISTRY.md` (10 issues, 14-field records) · `docs/migrations/FERRIX_TO_WANYRIX.md` · `GITHUB_ACTIONS_REQUIRED.md`

---

## 1. Headline findings

1. **The "completed" rename never existed.** The prior session claimed migration commit
   `4733c36`; it is not in `git log --all`. At baseline the product was 100% Ferrix
   (291 tokens / 50 files / 0 wanyrix). The audit **executed the real migration** and
   machine-verified it (branding gate PASS, zero unsanctioned residuals, browser E2E).
2. **A P0 persistence bug shipped silently.** All three zustand stores passed a
   `StateStorage` object where `createJSONStorage` requires a thunk; the swallowed
   `TypeError` disabled persistence AND the legacy-key migration across the entire
   product. Lint, 13× HTTP 200 probes, and component renders all passed — only
   instrumented browser storage inspection caught it. **Fixed and re-verified**
   (golden migration test: 3 keys copied, 3 legacy keys removed, write-through works).
3. **GitHub is unreachable from the sandbox** (404/no auth/9+ unpushed commits).
   All GitHub-side actions are prepared and documented; nothing was guessed or forced.
4. **Zero automated tests** remain the largest systemic risk (TEST_GAP, P1).

## 2. Verdict matrix (19 items)

| # | Area | Verdict | Evidence basis |
| --- | --- | --- | --- |
| 1 | Product identity (Wanyrix/W-EIR/WAN-*) | **PASS** (post-audit) | 0 unsanctioned residuals; gate PASS; UI/CLI/dialogs render Wanyrix; migration record §1–8 |
| 2 | Brand enforcement automation | **PARTIAL** | `scripts/check-branding.sh` works locally; **no CI runner** (no `.github/`, no push) |
| 3 | Persisted-state migration protocol | **PASS** (post-fix) | Golden E2E: copy-before-delete verified for all 3 keys; idempotent; SSR-safe |
| 4 | Persistence correctness | **PASS** (post-fix) | Write-through verified via UI; zustand warning gone; correction addendum §8 |
| 5 | Core loop surfaces (Overview/Doctor/Graph/Simulator/Diagnostics/PR/Experiments/Scorecard/Issues) | **PASS** | All 9 views render; doctor scan end-to-end (12 findings, W-EIR snapshot verified line); graph/impact/PR fixtures consistent |
| 6 | API contract fidelity (13 routes) | **PASS** | 200s on valid calls; impact 404/400 and explain 400/405 by-design contracts reproduced |
| 7 | AI honesty architecture | **PASS** | explain 200 with deterministic fact/inference/recommendation/uncertainty fallback; AI never mutates state; Estimated ≠ Measured ≠ Verified enforced in UI copy and scorecard gates |
| 8 | Measurement-status honesty | **PASS** | Doctor output shows MEASURED vs ESTIMATED blocks distinctly; simulator outputs labeled estimated |
| 9 | Required 14-item navigation | **FAIL → issue** | 9/14 first-class; 3 as overlays; 6 absent (AUDIT-I3) |
| 10 | Automated tests | **FAIL** | No framework, no tests, no CI (AUDIT-I4) |
| 11 | Documentation | **PARTIAL** | README + migration + audit records exist; no ARCHITECTURE/CLI/API docs (AUDIT-I6) |
| 12 | GitHub synchronization | **FAIL (blocked)** | 404/no auth/unpushed; checklist ready (AUDIT-I5) |
| 13 | Issue/PR traceability | **PARTIAL** | Board mirrors PRs by convention; untyped (AUDIT-I10) |
| 14 | Security posture (web repo) | **PASS (scoped)** | No secrets in tree; no auth surface; no silent modification — patches behind review queue |
| 15 | Performance evidence (web) | **PARTIAL** | Routes respond in single-digit ms (dev.log); no p95 budget/CI measurement |
| 16 | Reliability | **PARTIAL** | Dev server self-recovered across rename/rebuilds; no error budgets/SLOs for a demonstrator |
| 17 | Fixture/corpus integrity | **PASS** | Versioned flavors (`wanyrix.report/v1`, scan-history, scorecard), deterministic builders, contracts stable |
| 18 | Rust engine phases (CLI/daemon/SQLite/telemetry) | **N/A (platform repo)** | No Rust code in this repo; recorded as AUDIT-I8, not failed |
| 19 | Process integrity (claims vs reality) | **PASS (post-audit)** | False "done" claim detected, documented, corrected; every verdict above traces to commands run during this audit |

**Score: 10 PASS · 6 PARTIAL · 2 FAIL · 1 N/A** — before the audit the same matrix would
have scored identity #1 FAIL, #3 FAIL, #4 FAIL, #12 FAIL, #19 FAIL.

## 3. Gap classification summary

| Type | Count | IDs |
| --- | --- | --- |
| BUG (fixed) | 2 | I1 (P0), I2 (P0) |
| TEST_GAP | 1 | I4 (P1) |
| INTEGRATION_FAILURE | 1 | I5 (P1) |
| MISSING_FEATURE | 2 | I3 (P2), I10 (P4) |
| PARTIAL_IMPLEMENTATION | 1 | I7 (P3) |
| DOCUMENTATION | 1 | I6 (P3) |
| INFRASTRUCTURE | 1 | I9 (P4) |
| SCOPE (engine repo) | 1 | I8 (P3) |

No severity was inflated: every P0 has reproduced evidence; P2+ items are material but
non-blocking; the engine phases are scope notes, not failures.

## 4. Implementation roadmap

| Wave | Items | Outcome |
| --- | --- | --- |
| **P0 — blockers** | I1 ✔, I2 ✔ (done in audit); push + rename (I5 human step) | Product identity true everywhere; no silent state loss |
| **P1 — credibility** | I4 test harness + AUDIT-I1 regression test; CI runs brand gate; I5 completion | Claims become machine-checked |
| **P2 — product completion** | I3 fourteen-item IA (promote overlays, add Repositories/Architecture/Runtime/Organization/Settings) | Audit target surface reached |
| **P3 — depth** | I7 explain grounding; I6 docs trio; I8 contracts doc | AI and docs match the honesty bar |
| **P4+ — hygiene/future** | I9 dev-infra note; I10 typed traceability; then engine-repo phases (per AUDIT-I8) | Sustained, drift-proof |
| **P6 — beyond** | Real engine integration behind existing contracts; telemetry-backed measurements replacing estimates | Close the OBSERVE→…→LEARN loop for real workspaces |

**Dispatch plan (1 issue = 1 PR):** I4 → testing agent; I3 → frontend agent pair
(views A: Repositories/Findings/History; views B: Architecture/Runtime/Organization/
Settings); I7 → full-stack agent; I6 → docs agent; QA runs parallel happy+failure-path
E2E per PR. Every PR references its audit issue; every issue's DoD includes tests.

## 5. Answer to the product question

> **Can a real Rust developer take a real repository from discover → understand →
> diagnose → explain → recommend → change → verify → measure using Wanyrix today?**

**Not yet — and the audit can say so precisely.** What is real today (machine-verified
in this repo): the complete product surface and its honesty architecture — evidence-
first findings with stable IDs, calibrated confidence, measured/estimated/verified
separation, AI as an optional grounded layer with a deterministic fallback, reviewable
patches behind explicit approval, versioned contracts, and (post-audit) trustworthy
local persistence. A developer **evaluating** the loop on the fixture workspace gets a
faithful, honest demonstration end-to-end.

What is missing for a **real** repository: the engine (this repo has no Rust code —
AUDIT-I8), the 6 absent navigation surfaces (I3), automated tests proving contract
stability (I4), and the canonical GitHub home (I5). The loop closes the day the engine
repo meets the contracts this platform already encodes — which is exactly the roadmap
above.

## 6. Audit artifacts produced

`docs/audits/WANYRIX_BASELINE.md` · `docs/audits/AUDIT_REPORT.md` (this file) ·
`docs/audits/issues/` (registry + 10 records) · `docs/audits/GITHUB_ACTIONS_REQUIRED.md` ·
`docs/migrations/FERRIX_TO_WANYRIX.md` (+ §8 correction) · `scripts/check-branding.sh` ·
`src/lib/wanyrix/legacy-migration.ts` + store fixes · worklog entries.
