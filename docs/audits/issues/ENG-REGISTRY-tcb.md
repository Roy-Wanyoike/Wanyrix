# ENG-REGISTRY-tcb — UI persona QA fragment (Task 2-c-b)

**Agent:** UI persona QA · **Date:** 2026-09-18 · **Method:** agent-browser (own named
session for re-verification; contrast math validated against pixel sampling) + curl
cross-checks of the served API. Screenshots/JSON under `/tmp/wanyrix-qa/`.
**Duplicate check:** AUDIT-I1…I10 and ENG-TCA-1…7 reviewed before filing; no overlap
with the two new records below. GitHub unreachable → local records only.

## Issues filed

| ID | Title | Type | Severity | Status |
| --- | --- | --- | --- | --- |
| [ENG-TCB-1](ENG-TCB-1.md) | Impact Simulator "Add a dependency" catalog offers already-present crates (sqlx/reqwest on helios, datafusion on atlas) without an already-present guard | BUG / UX-HONESTY | P3 | Open |
| [ENG-TCB-2](ENG-TCB-2.md) | Honesty badges (ESTIMATED/MEASURED/VERIFIED/HIGH) fail WCAG AA contrast in light theme on Doctor / Simulator / Experiments (3.6–3.8:1 @ 10px/400) | BUG / ACCESSIBILITY | P3 | Open |

Severity policy honored: no P0/P1 — nothing breaks the product promise, data at rest, or
a primary flow; both records are quality/honesty-hygiene gaps.

## UI confirmations of already-filed issues (not re-filed)

- **ENG-TCA-3** (blast-radius honest-math contradictions) is visibly confirmed in the UI
  by persona 2: Doctor header says "common-runtime blocks **41** crates" while the Graph
  inspector says "blocks **38** workspace crates" (API: node claim `downstream:38`,
  doctor text 41, served-edge downstream closure 14); Simulator "Edit a source file"
  radio "common/src/error.rs **41** crates" vs its own card "**40** workspace crates
  re-invalidate"; upgrade radio "serde patch → **52** recompile" (52 > 47 workspace
  crates) while the served reverse closure of serde is 13 workspace crates (tokio: 46
  claimed vs 10 served; hyper: 23 vs 6); "Split a crate" tab shows `common` "before
  **42.1s**" while the Graph inspector shows common buildTime **6.8s**. Owners should
  fold these UI instances into the TCA-3 fix.
- **AUDIT-I7 / ENG-TCA-4** (explain grounding): not re-probed in depth this round; other
  agents own the explain route. No new evidence collected.

## Minor notes (observed, not filed — explicitly honest or sub-P4)

- Experiments EXP-016 "Run baseline" fires a toast labeled **"Baseline run queued
  (demo)"** and nothing else changes — honest demo labeling, but there is no UI path that
  advances the experiment pipeline from DRAFT; consider an explicit "demo-only" disabled
  state or a real queue.

## Flows verified clean (evidence)

| Persona | Flow | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 — build-perf eng. | Overview → Builds · Doctor (output-mode toggle, terminal, MEASURED 87.4s vs ESTIMATED 49–61s separation, confidence bar) | CLEAN | snapshot + `/tmp/wanyrix-qa/px-doctor-dark.png` |
| 1 | Worst finding detail (FER-BLD-001 critical): WHAT WANYRIX OBSERVED + EVIDENCE (4, each with source: cargo build --timings / cargo metadata / git log / graph diff) + IMPACT (ESTIMATED) + RECOMMENDED ACTION + VERIFICATION PATH + CONFIDENCE 86% | CLEAN — all 14-field detail sections present | drawer snapshot (desktop + mobile) |
| 1 | Experiment path: Doctor "See verified experiment" → EXP-014 "✓ VERIFIED IMPROVEMENT" (baseline 42.1s / candidate 31.8s, both MEASURED 5-run medians, 1,842 tests passed) — consistent with Doctor's "verified in EXP-014" claim; EXP-015 RUNNING (measured baseline); EXP-016 ESTIMATED + DRAFT ("No baseline… no number can be claimed") | CLEAN — **no false "Verified" claims found anywhere** | Experiments snapshots (desktop + mobile) |
| 2 — dependency owner | Graph → hub crate inspector (fan-in/out, blast radius, dependents, duplicates table) → "Open Impact Simulator" hand-off | CLEAN (numbers themselves → TCA-3 note above) | inspector snapshot + graph API curl |
| 2 | Simulator what-if: aws-sdk-s3 add card matches its catalog radio (31 crates, +38s CI), all four tabs carry ESTIMATED badges + "verified only through experiments" header | CLEAN labeling (premise guard gap → ENG-TCB-1) | `/tmp/wanyrix-qa/px-simulator-dark3.png` |
| 2 | Invalid input: UI is catalog-driven (radios only) — unknown crate / self-loop are **not enterable** by design; API-level invalid-input behavior already covered by ENG-TCA-6 | CLEAN at UI layer | Simulator tab snapshots |
| 2 | Simulator vs Graph cross-check math | DEFECT-ADJACENT → recorded as UI confirmation of ENG-TCA-3 (see above) | graph API + closures script (curl) |
| 3 — first-time evaluator | Cold landing: brand, "Engineering Health", workspace, scan-live, 4 KPIs visible immediately — product self-explains in <10s | CLEAN | `/tmp/wanyrix-qa/tcb-01-cold-landing.png` |
| 3 | Mobile 390×844 persona-1 flow: Overview → Doctor nav chip (44px targets) → FER-BLD-001 drawer (all sections) → Experiments; `scrollWidth == 390` at every step | CLEAN | `/tmp/wanyrix-qa/tcb-03…05, tcb-09*.png` |
| 3 | Dark theme badge contrast on the 3 densest views | CLEAN (11.3–13.0:1) | computed-style WCAG + pixel samples |
| 3 | Light theme badge contrast on the same views | **FAIL** → ENG-TCB-2 | `dump-*.json`, `tcb-08-doctor-light-contrast.png` |
| 3 | Workspace persistence on a fresh profile: pick atlas-consortium → reload → still atlas-consortium; localStorage `wanyrix.active-workspace` written | CLEAN (AUDIT-I1 fix holds) | eval + reload in own session |
| 3 | Console/page errors across all 18 views + all persona flows | CLEAN — zero errors (dev HMR/analytics info logs only) | `agent-browser console` / `errors` sweep |

## Environment notes

- Earlier shared-browser anomalies (theme flip-back, stale a11y refs mid-flow) were
  traced to the **default shared agent-browser session** being used by multiple agents;
  all re-verification was redone in a dedicated session (`AGENT_BROWSER_SESSION=tcb-qa`,
  closed after use). Not a product defect.
- No `src/**` files touched; no dev-server restart performed.
