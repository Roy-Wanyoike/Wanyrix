/**
 * fixtures/gates — release scorecard fixture (Gates 1..20 + blocking conditions).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (GATES) is unchanged.
 * Types: GATES is structurally typed (GatesPayload in ../types) — no type is
 * defined here, matching the original data.ts.
 */
// ---------------------------------------------------------------------------
// Release scorecard
// ---------------------------------------------------------------------------

export const GATES = {
  verdict: 'CONDITIONAL GO' as const,
  rationale:
    'All release-blocking gates pass. Two non-blocking gates remain conditional: doctor p95 on the medium fixture is 12.4s against the 10s target (profiling issue assigned), and the 10-developer usability study is scheduled for next sprint. Ship is permitted with documented mitigation.',
  gates: [
    { id: 1, name: 'Installation & clean environment', objective: 'Clean install, wanyrix --version, doctor boots', target: '100% clean-env success', measured: '100% (12/12 CI matrix runs)', status: 'pass', evidence: 'install-matrix job · all supported environments', blocking: true },
    { id: 2, name: 'Repository & Cargo discovery', objective: 'Correct metadata ingestion', target: '≥99.5% agreement · 0 graph errors', measured: '99.7% · 0 unexplained errors', status: 'pass', evidence: 'fixture suite ×10 repos vs cargo metadata', blocking: true },
    { id: 3, name: 'W-EIR snapshot integrity', objective: 'Valid, versioned, deterministic snapshots', target: '100% schema-valid · deterministic', measured: '100% · identical-input equivalence proven', status: 'pass', evidence: 'golden snapshot tests · schema v4', blocking: true },
    { id: 4, name: 'Incremental analysis', objective: 'Local changes invalidate locally', target: '≥95% work reduction', measured: '96.8% on 100-crate fixture', status: 'pass', evidence: 'invalidation benchmark · 1-file change', blocking: false },
    { id: 5, name: 'Engineering graph relationships', objective: 'Blast radius, critical path, git association', target: '100% on deterministic fixtures', measured: '100% (61/61 fixture cases)', status: 'pass', evidence: 'graph fixture corpus', blocking: true },
    { id: 6, name: 'Build intelligence accuracy', objective: 'Telemetry ingestion without silent loss', target: '≥99% event ingestion', measured: '99.4% (8,412/8,464 events)', status: 'pass', evidence: 'build event ingestion tests incl. failed builds', blocking: false },
    { id: 7, name: 'Finding quality & evidence', objective: 'Stable IDs, evidence, calibrated confidence', target: '≥90% precision · 100% evidence', measured: '93% precision · 100% evidence traceability', status: 'pass', evidence: 'false-positive fixture suite (12 analyzers)', blocking: true },
    { id: 8, name: 'Doctor actionability', objective: 'What/Why/Evidence/Impact/Recommendation/Verification', target: '100% actionable findings carry remediation', measured: '100% (12/12 findings)', status: 'pass', evidence: 'doctor output schema validation', blocking: true },
    { id: 9, name: 'AI grounding & safety', objective: 'AI never overrides evidence · fully optional', target: '0 grounding violations', measured: '0/240 adversarial prompts contradict evidence', status: 'pass', evidence: 'adversarial suite · AI-off deterministic run identical', blocking: true },
    { id: 10, name: 'Patch & experiment safety', objective: 'No silent modification · full experiment metadata', target: '100% reviewable diffs · metadata complete', measured: '100% (37 experiments audited)', status: 'pass', evidence: 'patch pipeline audit', blocking: true },
    { id: 11, name: 'CLI contract', objective: 'Exit codes + --json everywhere', target: '100% contract tests', measured: '100% (0/4/1/2 exit matrix covered)', status: 'pass', evidence: 'cli-contract test suite', blocking: false },
    { id: 12, name: 'Performance & memory', objective: 'Startup <150ms · incremental <1s · doctor <10s · idle <100MB', target: 'All budgets met', measured: 'startup 84ms · incremental 0.6s · doctor p95 12.4s · idle 61MB', status: 'conditional', evidence: 'doctor p95 exceeds target on medium fixture — profiling issue WAN-114, owner: compiler-perf team', blocking: false },
    { id: 13, name: 'Large-repository stress', objective: '≥500 crates without pathology', measured: '512-crate synthetic graph: no crash, RSS 1.8GB, graph correct', target: 'No crash/corruption/pathological growth', status: 'pass', evidence: 'stress rig run 2026-09-14', blocking: false },
    { id: 14, name: 'Failure recovery & daemon', objective: 'Survive failure injection · 24h soak', measured: '0 corruption · 0 crashes · soak 24h clean', target: '0 unrecoverable states', status: 'pass', evidence: '12 failure-injection scenarios + soak log', blocking: true },
    { id: 15, name: 'Security & privacy', objective: 'Audit, SAST, secrets, local-only guarantee', measured: '0 criticals · 0 secrets · 0 unexpected transmissions', target: '0 criticals · 0 leaks', status: 'pass', evidence: 'cargo-audit + SAST + secret scan + network monitor', blocking: true },
    { id: 16, name: 'Architecture boundaries', objective: 'No forbidden deps · no core cycles', measured: '0 violations · 0 cycles', target: '0 violations', status: 'pass', evidence: 'architecture test suite in CI', blocking: true },
    { id: 17, name: 'Observability', objective: '100% top-level jobs traceable', measured: '100% (analysis IDs on every job)', target: '100% traceable', status: 'pass', evidence: 'trace sampling audit', blocking: false },
    { id: 18, name: 'Test & fixture reliability', objective: '100 consecutive suite runs, 0 flaky', measured: '100/100 green · 0 flaky', target: '0 flaky failures', status: 'pass', evidence: 'nightly repeatability rig', blocking: true },
    { id: 19, name: 'Documentation & usability', objective: 'Docs complete · ≥70% task completion · 7/10 articulate value', measured: 'docs 100% · user study scheduled sprint 42', target: '≥70% completion', status: 'conditional', evidence: 'study protocol pre-registered; baseline workflow defined', blocking: false },
    { id: 20, name: 'Full MVP value loop', objective: 'Install → doctor → finding → experiment → verified result', measured: 'End-to-end scenario passes on 3 fixtures', target: '100% pass', status: 'pass', evidence: 'e2e-acceptance test (20 steps)', blocking: true },
  ].map((g) => ({ ...g, status: g.status as 'pass' | 'conditional' | 'fail' | 'pending' })),
  blockingConditions: [
    { condition: 'Critical security vulnerability', clear: true, note: '0 known criticals (cargo-audit + SAST)' },
    { condition: 'Database corruption', clear: true, note: 'SQLite integrity_check OK after all kill scenarios' },
    { condition: 'Unrecoverable daemon state', clear: true, note: '12/12 failure-injection scenarios recoverable' },
    { condition: 'Incorrect dependency graph', clear: true, note: '0 unexplained mismatches vs cargo metadata' },
    { condition: 'Incorrect deterministic findings', clear: true, note: '93% precision on fixture suite, 100% evidence' },
    { condition: 'Silent source-code transmission', clear: true, note: 'network-monitored local-only run: 0 egress' },
    { condition: 'Silent AI repository modification', clear: true, note: 'all patches require explicit diff approval' },
    { condition: 'Reproducibility failure', clear: true, note: 'identical inputs → equivalent snapshots ×100 runs' },
    { condition: 'Architectural boundary violation', clear: true, note: '0 violations, CI-enforced' },
    { condition: 'Critical-path flaky tests', clear: true, note: '100 consecutive green runs' },
    { condition: 'Unbounded memory growth', clear: true, note: 'bounded in 24h soak; RSS plateau at 1.8GB on 512-crate rig' },
    { condition: 'Unbounded disk growth', clear: true, note: 'wanyrix storage + retention GC verified' },
    { condition: 'Major unexplained performance regression', clear: true, note: 'benchmark suite green; doctor p95 gap documented (WAN-114)' },
    { condition: 'Findings without evidence', clear: true, note: 'schema enforces evidence array on all findings' },
    { condition: 'Estimated results presented as verified', clear: true, note: 'measurement-status labels enforced in output schema' },
    { condition: 'Broken machine-readable CLI contracts', clear: true, note: 'exit-code + --json matrix 100% green' },
    { condition: 'Failed end-to-end MVP workflow', clear: true, note: '20-step e2e acceptance passing' },
  ],
}

