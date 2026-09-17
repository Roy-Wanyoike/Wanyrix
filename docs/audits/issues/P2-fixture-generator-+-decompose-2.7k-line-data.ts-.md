# [P2][data] Fixture generator + decompose 2.7k-line data.ts into per-domain modules

Labels: P2, refactor, data, architecture

## Problem
All payloads come from one hand-authored monolith (`src/lib/wanyrix/data.ts`, ~2,770 lines). Fixture numbers can silently drift between views (doctor totals vs overview KPIs vs gates), and the file is the highest-risk edit surface in the repo.

## Evidence
- `wc -l src/lib/wanyrix/data.ts` ≈ 2,770; exports consumed by 12 API routes + components.
- Audit §2 rows “Engineering Graph (real): fixture-only”, “Build Intelligence: fixture-only”.

## CurrentBehavior
Static objects edited by hand; cross-view consistency is manual; no generator to regenerate the fixture workspace.

## ExpectedBehavior
1) A deterministic **fixture generator** (script) that derives helios-platform/atlas-consortium datasets from a declarative workspace spec (47 crates, 212 edges) — regeneration is reproducible and diffable; 2) `data.ts` split into `lib/wanyrix/data/{workspaces,health,doctor,graph,impact,diagnostics,experiments,pr,gates,issues,storage,report}.ts` with the same public getters; 3) cross-view invariant tests (finding counts, duplicate groups, gate evidence numbers agree) — enabled by #2.

## AffectedComponents
src/lib/wanyrix/data.ts → src/lib/wanyrix/data/*; scripts/generate-fixtures.ts.

## RootCause
Organic growth over 10 rounds; single-file was pragmatic early, now a merge hazard.

## ImplementationRequirements
Pure refactor — zero payload changes (byte-identical API responses verified in tests) — then generator on top. Keep REPO_URL/version semantics untouched.

## AcceptanceCriteria
- [ ] API responses byte-identical before/after (snapshot tests)
- [ ] `bun run fixtures:generate` reproducible (clean diff on re-run)
- [ ] data.ts ≤ 300 lines (barrel + shared helpers only)

## TestsRequired
Golden API snapshots; invariants (per issue #2).

## SecurityConsiderations
Fixture content stays synthetic; generator must not read real repos.

## PerformanceConsiderations
Route handlers unchanged; cold-start unchanged.

## Dependencies
#2 (tests first), #3 (CI).

## DefinitionOfDone
Audit §2 “fixture” rows upgraded to “generated fixture + invariants tested”.


---
_Source: Wanyrix full product audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md · docs/audits/issues/). Labels: P2, refactor, data, architecture_