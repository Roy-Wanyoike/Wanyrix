# FINAL-3 — Engine phase-2 surfaces not yet built (daemon, SQLite, telemetry, large-repo perf)

## 1. Problem
`wanyrix-engine` v0.1.0 (landed this round under `engine/`, 25 tests green) covers
measured filesystem manifest analysis only. The master contract's engine surface
set additionally requires: long-lived daemon, SQLite persistence, rustc/telemetry
collection, and 500-crate-scale performance characterization.

## 2. Evidence
`engine/README.md` roadmap lists daemon/SQLite/telemetry as NOT built;
`docs/audits/ACCEPTANCE_GATES.md` gates #2, 6–8, 10–13, 15, 16, 19, 30 = IN PROGRESS.

## 3. Current behavior
`wanyrix doctor|graph|health` work per-invocation against a directory; no
persistence between runs; no compiler telemetry.

## 4. Expected behavior
Daemon with idle memory <100 MB (gate 14); SQLite store surviving forced
interruption (gate 31); telemetry pipeline excluding sensitive source by default
(gate 41); 500-crate synthetic workspace analyzed within budget (gate 16);
incremental analysis ≥95% reduction where the graph permits (gate 10).

## 5. Root cause
Phased build order — v0 proves the contract-conformance approach first;
persistence/telemetry are the next phase.

## 6. Implementation requirements
(a) SQLite store via rusqlite (bundled feature; gcc present) with WAL +
interruption-recovery test; (b) daemon process with IPC matching a new additive
`wanyrix.daemon/v1` schema; (c) rustc JSON diagnostics capture with default-on
secret/source redaction; (d) 500-crate synthetic fixture + committed timing
characterization.

## 7. Acceptance criteria
- [ ] Gates #10–14, 16, 19, 30, 31 flip IN PROGRESS→PASS with committed evidence.
- [ ] No regression in the 25 existing engine tests.

## 8. Tests required
cargo test expansion incl. crash-recovery and redaction unit tests; soak evidence
recorded in `docs/PERFORMANCE.md`.

## 9. Security considerations
Telemetry must exclude sensitive source by default (gate 41); the store must not
leak workspace paths across users.

## 10. Performance considerations
Gate 10 (incremental ≥95%) and gate 14 (idle daemon <100 MB) are the tracked budgets.

## 11. Documentation requirements
`engine/README.md` roadmap update per merged phase; W-EIR doc stays authoritative
for schema versioning.

## 12. Definition of Done
All listed engine gates PASS with evidence; issue closes via linked PR. **Severity:** HIGH (product core), phased.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "engine: phase-2 surfaces — daemon, SQLite store, rustc telemetry, 500-crate perf (FINAL-3)" \
  -b "See docs/audits/issues/FINAL-3.md and engine/README.md roadmap" -l "engine"
```
