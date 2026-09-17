# [P1][core] Umbrella: implement the Wanyrix product core (CLI → daemon → engine → W-EIR → graph → doctor → experiments)

Labels: P1, product-core, epic

## Problem
The web platform (this repo) is a verified design demonstrator over fixture evidence. The deterministic Rust core that produces real evidence from real repositories does not exist in any repository. Until it exists, the final product question (“can a real Rust developer point Wanyrix at a real repository…”) is answered **not yet**.

## Evidence
- Full audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md §2): CLI, daemon, engine, collectors, durable W-EIR, experiment runner = absent product-level.
- Component matrix cells for CLI/Daemon/Engine/Collectors/W-EIR persistence = ❌ with no alternate repo.

## CurrentBehavior
Engineering intelligence shown in the UI is hand-authored fixture data (`src/lib/wanyrix/data.ts`).

## ExpectedBehavior
A Rust workspace (separate repos: `wanyrix` CLI crate + `wanyrix-*` workspace members per docs/migrations/FERRIX_TO_WANYRIX.md canonical identity) implementing Phase 1–7 of the build program: core runtime → repository intelligence → engineering graph → build intelligence → findings → incremental → experiments, honoring the CLI contract (`wanyrix --version/init/status/doctor/analyze/dependencies/graph/findings/explain/experiment/verify/patch/storage`, exit codes 0/1/2/3, `--json` everywhere).

## AffectedComponents
New Rust workspace; this web repo later consumes real payloads behind the same /api/wanyrix contracts.

## RootCause
Program order: web demonstrator was built first to lock UX/evidence semantics; core implementation is the next phase.

## ImplementationRequirements
1) Repo scaffolding + CI; 2) core runtime (storage, config, daemon lifecycle, graceful recovery); 3) cargo/git/rustc collectors with ≥99.5% metadata agreement vs fixture corpus; 4) W-EIR snapshots (deterministic, versioned, integrity-tested); 5) graph + blast radius (100% fixture correctness); 6) doctor findings with 100% evidence traceability; 7) incremental ≥95% work reduction; 8) experiment runner with real baseline/candidate measurement.

## AcceptanceCriteria
- [ ] Phase 1–7 exit gates of the build program each pass their quantified targets
- [ ] `wanyrix doctor` on a fixture repo with an intentionally constructed bottleneck names it with evidence
- [ ] Full loop OBSERVE→LEARN executable end-to-end on a real repository

## TestsRequired
Golden snapshot tests; fixture corpus (single crate → 500+ crate synthetic); determinism (same input ⇒ equivalent snapshot ×100); CLI contract tests (exit codes, --json); crash-recovery tests (kill during write → SQLite integrity_check OK).

## SecurityConsiderations
Local-only mode; no source transmission; secrets never persisted into W-EIR evidence.

## PerformanceConsiderations
CLI start p95<150ms; incremental p95<1s; doctor p95<10s (medium repo); idle daemon<100MB.

## Dependencies
None (new workspace). Web repo issues #2/#3 gate any switch to live payloads.

## DefinitionOfDone
Phase 1–7 gates green in the core repo, documented in its own audit, linked back here; web platform unchanged.


---
_Source: Wanyrix full product audit 2026-09-17 (docs/audits/WANYRIX_FULL_AUDIT_REPORT.md · docs/audits/issues/). Labels: P1, product-core, epic_