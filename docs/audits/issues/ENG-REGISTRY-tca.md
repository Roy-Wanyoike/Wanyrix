# ENG-REGISTRY-tca — Task 2-c-a (REST SDK persona QA) issue fragment

**Task:** 2-c-a — Engineer-persona simulation, REST/JSON SDK surface (CI bot + data-pipeline engineer + impact analyst + contract stress + offline-honesty probe)
**Agent:** SDK persona QA · **Date:** 2026-09-18 · **Evidence scripts:** `/tmp/wanyrix-qa/` (ci-bot.ts, report-validate.ts, graph-math.ts, adv.json, big.json + raw JSON captures)
**Rules honored:** read-only on `src/**`; no AUDIT-* / ISSUE_REGISTRY.md edits; evidence = exact command + output for every claim.

## Issues filed by this task

| ID | Title | Type | Severity | Status |
| --- | --- | --- | --- | --- |
| [ENG-TCA-1](ENG-TCA-1.md) | Unknown `ws` silently returns default workspace data (200); `/report` + `/experiments` stamp bogus id into the artifact | BUG / API contract + data integrity | **P2** | Open |
| [ENG-TCA-2](ENG-TCA-2.md) | `wanyrix.release-scorecard/v1` + `wanyrix.scan-history/v1` flavors are client-only — not reachable over HTTP SDK surface | MISSING_FEATURE (SDK gap) | P3 | Open |
| [ENG-TCA-3](ENG-TCA-3.md) | Blast-radius math contradicts itself inside one `/graph` payload (blast vs node downstream vs served edges, 50 mismatches; duplicateBefore/recompileCrates/ghost-crate) | BUG (honest-math) | **P2** | Open |
| [ENG-TCA-4](ENG-TCA-4.md) | `/explain` live-AI path: adversarial prompts corrupt OBSERVED FACT line + invented "authoritative" values (12.4s) not in context | BUG (AI grounding / honesty) | **P2** | Open |
| [ENG-TCA-5](ENG-TCA-5.md) | `estimatedRange` semantics lost in machine flavors — "Build time 87.4s (estimated range 49.0–61.0s)" reads as impossible confidence interval | BUG (schema self-description) | P3 | Open |
| [ENG-TCA-6](ENG-TCA-6.md) | REST hygiene: 405 lacks `Allow`, missing-param→404 conflation, silent `kind` coercion, unversioned markdown envelope | CONTRACT_HYGIENE | P4 | Open |
| [ENG-TCA-7](ENG-TCA-7.md) | `/explain` unbounded payload: 2 MB context stalls caller for full 30 s provider timeout before fallback | PERF / ROBUSTNESS | P3 | Open |

Severity calibration: no P0/P1 — nothing found destroys data, breaks the offline
deterministic core, or blocks development; P2s are silent wrong-data/contradiction
cases for machine consumers, which the honesty architecture claims to prevent.

## Workflows tested → verdicts (with evidence)

1. **CI-bot (workspaces → doctor → exit-code)** — ✅ verified clean apart from ENG-TCA-1.
   Evidence: `bun /tmp/wanyrix-qa/ci-bot.ts` → 2 workspaces discovered, 19 findings all
   with stable IDs (`FER|ATL-XXX-nnn`), non-empty evidence (label/value/source ≥2),
   recommendations, confidence 0–100, measurementStatus present; exit code 2 derived
   purely from JSON (critical present). No HIGH-named severity exists — ladder is
   critical/warning/info (documented in script logic).
2. **Pipeline engineer (report + diff + gates/scorecard)** — ✅ `wanyrix.report/v1`
   self-consistent (schema field, ISO timestamps, honestyNotes, non-empty evidence, no
   Estimated-inside-Measured violation, storage labeled simulated); two identical calls
   byte-identical minus `generatedAt`/`lastGc`; regression summary derivable
   (crates 47 vs 23, buildTime 87.4 vs 52.8, findings 12 vs 7). ⚠️ ENG-TCA-2
   (scorecard/scan-history flavors unreachable), ENG-TCA-5 (estimatedRange semantics).
3. **Impact analyst (graph → impact cross-check)** — ❌ ENG-TCA-3 (blast/node/edge
   contradictions). ✅ Error contracts verified: unknown target 404, unknown type 400
   (by-design); every catalog id (6 add-deps, 4 upgrades, 1 split, 5 blast files)
   resolves 200 via `/impact`.
4. **Contract stress** — ✅ method matrix 13 routes × GET/POST/PUT/DELETE: GET-only
   routes 405 on all wrong methods, explain POST-only; 405s lack `Allow` (ENG-TCA-6).
   ✅ determinism: 9 GET routes byte-identical ×3 calls; report byte-identical minus
   timestamps. ✅ `?ws=<script>` reflected only JSON-encoded with
   `application/json` — no execution vector (recorded clean). ✅ malformed JSON → 400;
   ✅ oversized 2 MB → ENG-TCA-7 (30 s stall, then honest fallback).
5. **Offline-honesty probe (simulated)** — ✅ `/explain` without context/question → 400
   (`context and question are required`) ×3 variants (by-design contract holds);
   deterministic fallback labeled OBSERVED FACT / INFERENCE / RECOMMENDATION /
   UNCERTAINTY in all 6 kinds (incl. unknown kind — coerced, see ENG-TCA-6c);
   `grounded:false` + `ok:false` flags honest on fallback; adversarial live-AI probe
   surfaced ENG-TCA-4 (2 of 3 runs corrupted OBSERVED FACT / invented values; the
   fully-resisted run still invented an EXP-014 reference). No silent data invention
   observed outside the explain live-AI path.

## Environmental note (not filed as product issue)
At ~11:52Z the dev server returned 500 `text/html` for every API route, then went down
(000), while a concurrent agent (Task 2-b, 14-item IA) was editing `src/app/**` +
`src/components/wanyrix/**` (`dev.log`: module-not-found `dependencies-view`; a `bunx
tsc --noEmit` was observed running). Server returned ~11:58Z; all key findings were
re-verified post-restart (doctor substitution, report mislabel, blast 22-vs-6,
experiments ws-echo). API-route 500s rendering HTML instead of a JSON error envelope is
a dev-mode framework behavior during compile errors — noted here for the contract-test
suite (Task 2-a) to assert JSON error envelopes in healthy states only.

## Areas verified clean (summary + evidence command)
- Doctor finding schema completeness (19/19 findings): `bun /tmp/wanyrix-qa/ci-bot.ts`
- `/report` flavor self-consistency + determinism: `bun /tmp/wanyrix-qa/report-validate.ts`
- Impact catalog/target resolution + by-design 404/400 contracts: catalog loop in §4 of ENG-TCA-3 evidence
- Route determinism (9 routes × 3 byte-compares): determinism matrix in WF4 transcript
- Method matrix shape (13 × 4): WF4 transcript (`405` correctness)
- Explain 400 contract + fallback labeling (6 kinds): WF5 transcript
- JSON-reflection safety (`?ws=<script>`): WF4 transcript
