# [P3][docs] Traceability board overstates mirror fidelity (19 issues claimed; upstream has 0)

Labels: P3, documentation, honesty

## Problem
The in-app “Issues & PRs” board states it mirrors “the live repo” with 19 issues and PRs #10–#47, and renders `WAN-101…` rows referencing GitHub issues #1–#44. The live repository has **0 real issues** and 25 PRs (#10–#48). The board is a curated fixture presented with live-repo authority — a traceability honesty gap in a product whose brand is evidence integrity.

## Evidence
- GitHub API `GET /repos/Roy-Wanyoike/wanyrix/issues?state=all` → 25 items, all `pull_request` objects; 0 issues.
- App board footer: “19 issues · 19 PRs · 0 open · issues #1–#44 · PRs #10–#47 mirror the live repo” (browser-verified 2026-09-17).

## CurrentBehavior
Board rows link WAN-* ids to GitHub numbers that 404.

## ExpectedBehavior
Either (a) relabel the board as a *curated governance fixture* and drop live-mirror wording, or (b) make it actually live: fetch real issues/PRs via API at build/runtime (public repo data only) and mark fixture rows clearly when upstream objects are absent.

## AffectedComponents
src/components/wanyrix/views/issues-view.tsx, src/lib/wanyrix/data.ts (issues payload).

## RootCause
Board predates the audit that counted upstream objects; mirror-note ranges were computed from data (#32) but the underlying numbers were never reconciled with GitHub.

## ImplementationRequirements
Copy fix for (a); read-only sync + graceful fallback for (b). Do not invent issue numbers.

## AcceptanceCriteria
- [ ] No claim in the UI contradicts verifiable repo metadata
- [ ] Every GitHub number rendered resolves to a real upstream object (or is explicitly labeled fixture)

## TestsRequired
E2E: every `github.com/Roy-Wanyoike/wanyrix/(issues|pull)/N` link rendered by the board returns 200 (needs #2/#3).

## SecurityConsiderations
If live-sync: unauthenticated public API only, cached, no tokens client-side.

## PerformanceConsiderations
Cache sync result (ISR/SWR) to keep TTFB budget.

## Dependencies
None blocking; #2 for the link-check test.

## DefinitionOfDone
Board copy and data source agree; audit §7 finding closed.


---
_Source: Wanyrix full product audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md · docs/audits/issues/). Labels: P3, documentation, honesty_