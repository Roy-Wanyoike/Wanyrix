# [P3][ai] Automated adversarial harness for the AI reasoning layer (0-contradiction target)

Labels: P3, ai, testing

## Problem
The explain route enforces grounding by prompt rules + fallback, but there is no automated adversarial suite proving “0 authoritative-evidence contradictions” (audit program Phase 15 target). Today the property is verified manually.

## Evidence
- Audit §3: AI spot-check PASS manually (PR #184 numbers traced to evidence); §2 “AI: no automated harness”.
- src/app/api/wanyrix/explain/route.ts: SYSTEM_BASE rules + FALLBACKS.

## CurrentBehavior
One-off manual probes (invented dependency / invented measurement / false verification / contradiction requests).

## ExpectedBehavior
Scripted harness: fixed evidence contexts + adversarial question set (invent a crate, invent a file, inflate a measurement, claim verified-from-estimated, contradict build data, ask to re-label); asserts every response: contains all four structural labels, never upgrades a label (no `measured`/`verified` where evidence says `estimated`), cites only context entities. Runs against the real provider nightly + against FALLBACKS deterministically in CI.

## AffectedComponents
src/app/api/wanyrix/explain/route.ts (testability), tests/ai-harness.

## RootCause
AI layer added in round 4 with manual QA only.

## ImplementationRequirements
Extract label-validator as pure function (shared by route + harness); record harness report as CI artifact.

## AcceptanceCriteria
- [ ] Deterministic fallback passes 100% of adversarial set in CI
- [ ] Live-provider run ≥ target with violations reported, not silently swallowed
- [ ] AI failure keeps deterministic UI functional (already E2E-verified; add regression test)

## TestsRequired
The harness itself.

## SecurityConsiderations
Harness must not send real repo content; synthetic contexts only.

## PerformanceConsiderations
Nightly live run, not per-PR.

## Dependencies
#2, #3.

## DefinitionOfDone
Audit Phase 15 row gains automated evidence.


---
_Source: Wanyrix full product audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md · docs/audits/issues/). Labels: P3, ai, testing_