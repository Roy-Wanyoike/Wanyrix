import type {
  ActivityEvent,
  BlastEntry,
  DiagnosticsPayload,
  DoctorReport,
  DuplicateGroup,
  Experiment,
  Finding,
  GraphEdge,
  GraphNode,
  HealthPayload,
  IssueItem,
  PRAnalysis,
} from './types'

export const REPO_URL = 'https://github.com/Roy-Wanyoike/ferrix'

export const WORKSPACE = {
  name: 'helios-platform',
  description: 'Payments platform · 47 workspace crates · rustc 1.84.1 · dev profile',
  crates: 47,
  backboneNodes: 36,
  edges: 212,
  toolchain: 'rustc 1.84.1 (a07f3eb) · cargo 1.84.0',
  profile: 'dev',
  lastScan: '2026-09-17T09:12:04Z',
}

// ---------------------------------------------------------------------------
// Doctor — build intelligence findings
// ---------------------------------------------------------------------------

export const FINDINGS: Finding[] = [
  {
    id: 'FER-BLD-001',
    section: 'Build',
    severity: 'critical',
    title: 'common-runtime sits on the critical path',
    description:
      'common-runtime compiles before 41 workspace crates can start. It is 18.3s of the 87.4s development build and changed 23 times in the last 90 days, so the expensive path is also the hot path.',
    evidence: [
      { label: 'Build time', value: '18.3s', source: 'cargo build --timings' },
      { label: 'Downstream crates', value: '41', source: 'cargo metadata graph' },
      { label: 'Changes (90d)', value: '23 commits', source: 'git log' },
      { label: 'Rebuild amplification', value: '×41 on every touch', source: 'ferrix graph diff' },
    ],
    affected: ['common-runtime', 'api', 'gateway', 'worker', 'payments-core', '+36 more'],
    impact: '≈ −12.4s average incremental build if split (estimated)',
    impactSeconds: 12.4,
    recommendation:
      'Split into runtime-core (stable abstractions, rarely changed) and runtime-telemetry (volatile). Downstream crates then depend on the cheap, stable half.',
    remediationKind: 'architecture',
    verificationPath:
      'Create an experiment: baseline 42.1s median of 5 clean builds → candidate build with split applied → cargo test → measured delta recorded in EXP-014.',
    confidenceClass: 'high',
    confidence: 86,
    detection: 'critical-path analysis over cargo build --timings + cargo metadata',
    measurementStatus: 'estimated',
  },
  {
    id: 'FER-BLD-002',
    section: 'Build',
    severity: 'warning',
    title: '3 crates compile multiple versions',
    description:
      'Cargo.lock resolves tokio, serde and uuid to two versions each. Every duplicate version is compiled separately and both copies are linked into the final binary.',
    evidence: [
      { label: 'tokio', value: '1.34.2 + 1.40.0', source: 'Cargo.lock' },
      { label: 'serde', value: '1.0.203 + 1.0.210', source: 'Cargo.lock' },
      { label: 'uuid', value: '0.8.2 + 1.8.0', source: 'Cargo.lock' },
      { label: 'Duplicate compile cost', value: '6.8s per clean build', source: 'cargo build --timings' },
    ],
    affected: ['tokio', 'serde', 'uuid', 'legacy-cache'],
    impact: '≈ −6.8s clean build (estimated)',
    impactSeconds: 6.8,
    recommendation:
      'Run `cargo update -p tokio@1.34.2 --precise 1.40.0` (same for serde). Migrate legacy-cache off uuid 0.8, then re-lock.',
    remediationKind: 'command',
    verificationPath: 'Re-run `ferrix doctor` after re-lock: duplicate-version findings must drop to 0.',
    confidenceClass: 'deterministic',
    confidence: 100,
    detection: 'Cargo.lock version multiplicity scan',
    measurementStatus: 'measured',
  },
  {
    id: 'FER-BLD-003',
    section: 'Build',
    severity: 'warning',
    title: 'Feature unification creates 2 duplicate builds',
    description:
      'serde is built twice — once with derive, once without — because the workspace still uses resolver v1 semantics. Both artifacts live in target/debug and invalidate independently.',
    evidence: [
      { label: 'Duplicate artifacts', value: '2', source: 'target/debug fingerprints' },
      { label: 'Resolver', value: 'v1 (implicit)', source: 'workspace Cargo.toml' },
      { label: 'Wasted compile', value: '4.1s', source: 'cargo build --timings' },
    ],
    affected: ['serde', 'serde_derive', 'common'],
    impact: '≈ −4.1s clean build (estimated)',
    impactSeconds: 4.1,
    recommendation:
      'Set `resolver = "2"` in the workspace Cargo.toml and move shared dependencies to [workspace.dependencies].',
    remediationKind: 'config',
    verificationPath: 'cargo tree -d must report a single serde build after the change.',
    confidenceClass: 'high',
    confidence: 78,
    detection: 'fingerprint dedup scan across target/ artifacts',
    measurementStatus: 'estimated',
  },
  {
    id: 'FER-BLD-004',
    section: 'Build',
    severity: 'warning',
    title: 'Proc-macro chain adds ~11.2s to cold builds',
    description:
      'syn, quote and proc-macro2 are compiled in 3 separate version sets because different crates pin different ranges. The chain must fully compile before any derive-using crate can start.',
    evidence: [
      { label: 'Chain total', value: '11.2s', source: 'cargo build --timings' },
      { label: 'Version sets', value: '3', source: 'Cargo.lock' },
      { label: 'Derive-using crates', value: '14', source: 'cargo metadata' },
    ],
    affected: ['syn', 'quote', 'proc-macro2', 'serde_derive', 'sqlx-macros', 'clap_derive'],
    impact: '≈ −5.6s clean build (estimated)',
    impactSeconds: 5.6,
    recommendation:
      'Pin a single syn/quote/proc-macro2 set in [workspace.dependencies] so all derive crates share one compiled chain.',
    remediationKind: 'config',
    verificationPath: 'cargo tree -i syn must resolve to exactly one version.',
    confidenceClass: 'high',
    confidence: 83,
    detection: 'proc-macro dependency chain analysis',
    measurementStatus: 'estimated',
  },
  {
    id: 'FER-BLD-005',
    section: 'CI',
    severity: 'info',
    title: 'Incremental compilation disabled in CI',
    description:
      'CARGO_INCREMENTAL=0 is correct for cacheability, but there is no compensating shared cache — CI recompiles the world on every pipeline.',
    evidence: [
      { label: 'Env', value: 'CARGO_INCREMENTAL=0', source: '.github/workflows/ci.yml' },
      { label: 'Shared cache', value: 'none configured', source: 'workflow definition' },
    ],
    affected: ['ci'],
    impact: 'CI-only; see FER-DEP-006 for the measured miss rate',
    recommendation: 'Adopt cargo-chef + sccache with a shared backend as the cache strategy.',
    remediationKind: 'config',
    verificationPath: 'Cache hit rate metric in CI telemetry must exceed 85% after rollout.',
    confidenceClass: 'deterministic',
    confidence: 100,
    detection: 'CI workflow configuration lint',
    measurementStatus: 'measured',
  },
  {
    id: 'FER-DEP-006',
    section: 'CI',
    severity: 'critical',
    title: 'CI cache miss rate is 68%',
    description:
      '34 of the last 50 CI jobs rebuilt the full dependency graph. Average cold CI build is 14m12s, dominating pipeline wall time and cost.',
    evidence: [
      { label: 'Cache miss rate', value: '68%', source: 'CI telemetry (last 50 jobs)' },
      { label: 'Cold CI build', value: '14m12s avg', source: 'CI telemetry' },
      { label: 'Jobs affected', value: '34/50', source: 'CI telemetry' },
    ],
    affected: ['ci'],
    impact: '≈ −41% CI build time (estimated)',
    recommendation:
      'Introduce cargo-chef recipe layering and a shared sccache backend keyed by Cargo.lock hash.',
    remediationKind: 'config',
    verificationPath: 'ferrix storage + CI telemetry: miss rate must fall below 25% for 50 consecutive jobs.',
    confidenceClass: 'high',
    confidence: 90,
    detection: 'CI build telemetry ingestion',
    measurementStatus: 'estimated',
  },
  {
    id: 'FER-WRK-007',
    section: 'Workspace',
    severity: 'critical',
    title: 'common blocks 41 downstream crates',
    description:
      'common is the highest fan-out workspace crate (11 direct dependents, 41 transitive) and is edited frequently. Every edit to error abstractions amplifies into a workspace-wide rebuild.',
    evidence: [
      { label: 'Fan-in (direct)', value: '11 crates', source: 'cargo metadata' },
      { label: 'Downstream', value: '41 crates', source: 'ferrix graph diff' },
      { label: 'Changes (90d)', value: '31 commits', source: 'git log' },
      { label: 'Rebuild cost', value: '+12.8s incremental', source: 'build telemetry' },
    ],
    affected: ['common', 'api', 'auth', 'gateway', 'worker', 'cli', '+35 more'],
    impact: '≈ −8.2s average incremental build after type extraction (estimated)',
    impactSeconds: 8.2,
    recommendation:
      'Move pure data abstractions (error, ids, DTOs) into a new common-types crate; keep implementations in common. See the architecture simulator for the projected graph.',
    remediationKind: 'architecture',
    verificationPath:
      'Blast-radius re-check: editing common/src/error.rs must affect ≤12 crates after the split.',
    confidenceClass: 'high',
    confidence: 88,
    detection: 'fan-out × change-frequency analysis over the engineering graph',
    measurementStatus: 'estimated',
  },
  {
    id: 'FER-WRK-008',
    section: 'Workspace',
    severity: 'warning',
    title: 'api crate contains 17 unrelated modules',
    description:
      'api mixes routing, handlers, email rendering, PDF generation and metrics exporters in one crate. Any module change rebuilds all 12.7s of it.',
    evidence: [
      { label: 'Modules', value: '17', source: 'source scan' },
      { label: 'Build time', value: '12.7s', source: 'cargo build --timings' },
      { label: 'LOC', value: '26,140', source: 'source scan' },
    ],
    affected: ['api', 'gateway'],
    impact: '≈ −3.9s average incremental build (estimated)',
    impactSeconds: 3.9,
    recommendation: 'Split into api-router, api-handlers and service-email/pdf support crates.',
    remediationKind: 'architecture',
    verificationPath: 'Re-run ferrix doctor; oversized-crate finding for api should clear.',
    confidenceClass: 'medium',
    confidence: 74,
    detection: 'module cohesion analysis',
    measurementStatus: 'estimated',
  },
  {
    id: 'FER-WRK-009',
    section: 'Workspace',
    severity: 'info',
    title: '4 crates exceed 25k LOC',
    description:
      'Large single-crate units concentrate compile time and review load. These are the top decomposition candidates.',
    evidence: [
      { label: 'common-runtime', value: '31,420 LOC', source: 'source scan' },
      { label: 'database', value: '27,830 LOC', source: 'source scan' },
      { label: 'api', value: '26,140 LOC', source: 'source scan' },
      { label: 'payments-core', value: '25,910 LOC', source: 'source scan' },
    ],
    affected: ['common-runtime', 'database', 'api', 'payments-core'],
    impact: ' architectural debt indicator — no direct build claim',
    recommendation: 'Plan staged decomposition using the architecture simulator before refactoring.',
    remediationKind: 'experiment',
    verificationPath: 'Track LOC + build time per crate across releases.',
    confidenceClass: 'deterministic',
    confidence: 95,
    detection: 'source inventory scan',
    measurementStatus: 'measured',
  },
  {
    id: 'FER-IDE-010',
    section: 'IDE',
    severity: 'critical',
    title: 'rust-analyzer checks all 47 workspace crates on save',
    description:
      'check.workspace = true makes every save trigger a workspace-wide cargo check. p95 inline-annotation latency is 8.7s on this machine.',
    evidence: [
      { label: 'Crates checked on save', value: '47', source: 'rust-analyzer settings' },
      { label: 'Annotation latency', value: 'p95 8.7s', source: 'editor telemetry' },
      { label: 'Setting', value: 'check.workspace = true', source: '.vscode/settings.json' },
    ],
    affected: ['rust-analyzer', 'developer workflow'],
    impact: '≈ −62% IDE check latency (estimated)',
    recommendation:
      'Set rust-analyzer.check.workspace = false and use flycheck-on-save for the current crate only (rust-analyzer#12882 pattern).',
    remediationKind: 'config',
    verificationPath: 'Editor telemetry: annotation p95 must drop below 3.5s.',
    confidenceClass: 'high',
    confidence: 80,
    detection: 'IDE configuration + latency telemetry',
    measurementStatus: 'estimated',
  },
  {
    id: 'FER-IDE-011',
    section: 'IDE',
    severity: 'warning',
    title: 'cargo check and rust-analyzer contend on one target dir',
    description:
      'Terminal cargo check and rust-analyzer share target/debug. File-lock waits average 2.3s at p95 and stall both tools.',
    evidence: [
      { label: 'Lock wait p95', value: '2.3s', source: 'build telemetry' },
      { label: 'Shared dir', value: 'target/debug', source: 'RA settings' },
    ],
    affected: ['rust-analyzer', 'cargo'],
    impact: '≈ −18% check latency (estimated)',
    recommendation: 'Set rust-analyzer.cargo.targetDir = "target/ra" to isolate RA artifacts.',
    remediationKind: 'config',
    verificationPath: 'Lock-wait metric disappears from build telemetry.',
    confidenceClass: 'high',
    confidence: 84,
    detection: 'target-dir lock contention telemetry',
    measurementStatus: 'estimated',
  },
  {
    id: 'FER-ASY-012',
    section: 'Async',
    severity: 'warning',
    title: 'Blocking call inside async task (worker::scan)',
    description:
      'worker/src/scan.rs:88 calls std::fs::read_dir directly inside an async fn, stalling the tokio worker thread for up to 340ms at p95.',
    evidence: [
      { label: 'Location', value: 'worker/src/scan.rs:88', source: 'static analysis' },
      { label: 'Worker stall', value: 'p95 340ms', source: 'tokio-console telemetry' },
      { label: 'Call', value: 'std::fs::read_dir', source: 'source scan' },
    ],
    affected: ['worker', 'tokio runtime'],
    impact: 'Latency spikes under load; no build-time claim',
    recommendation: 'Wrap directory iteration in tokio::task::spawn_blocking or switch to tokio::fs.',
    remediationKind: 'patch',
    verificationPath: 'tokio-console: worker stall p95 must drop below 10ms.',
    confidenceClass: 'deterministic',
    confidence: 100,
    detection: 'async blocking-call static analysis',
    measurementStatus: 'measured',
  },
]

export const DOCTOR: DoctorReport = {
  workspace: WORKSPACE.name,
  profile: WORKSPACE.profile,
  toolchain: WORKSPACE.toolchain,
  buildTime: 87.4,
  estimatedRange: [49, 61],
  confidence: 82,
  criticalPath: [
    { name: 'common-runtime', seconds: 18.3, kind: 'workspace' },
    { name: 'api', seconds: 12.7, kind: 'workspace' },
    { name: 'proc-macro chain', seconds: 15.4, kind: 'proc-macro' },
    { name: 'tokio', seconds: 8.2, kind: 'external' },
    { name: 'syn', seconds: 7.8, kind: 'external' },
    { name: 'serde', seconds: 6.1, kind: 'external' },
    { name: 'linking + codegen', seconds: 18.9, kind: 'linker' },
  ],
  findings: FINDINGS,
  scannedAt: WORKSPACE.lastScan,
  phases: [
    { label: 'Parsing cargo metadata', detail: '47 workspace crates · 212 edges' },
    { label: 'Reading Cargo.lock', detail: '3 duplicate version groups found' },
    { label: 'Ingesting build timings', detail: 'cargo build --timings · dev profile · 87.4s' },
    { label: 'Analyzing git history', detail: '1,204 commits · 90 days' },
    { label: 'Profiling proc macros', detail: '3 version sets · 14 derive crates' },
    { label: 'Checking feature unification', detail: 'resolver v1 · 2 duplicate artifacts' },
    { label: 'Correlating CI telemetry', detail: '50 jobs · 68% cache miss' },
    { label: 'Consulting engineering graph', detail: 'F-EIR snapshot 9f31c2a · verified' },
  ],
  summary: { developerBuild: '−34%', ciBuild: '−41%', diskUsage: '−27%' },
}

// ---------------------------------------------------------------------------
// Engineering graph
// ---------------------------------------------------------------------------

const W = (over: Partial<GraphNode> & { id: string }): GraphNode => ({
  band: 'lib',
  kind: 'workspace',
  buildTime: 4,
  fanIn: 1,
  fanOut: 2,
  downstream: 1,
  changeFreq: 5,
  ...over,
})

const E = (id: string, buildTime: number, over: Partial<GraphNode> = {}): GraphNode => ({
  id,
  band: 'external',
  kind: 'external',
  buildTime,
  fanIn: 1,
  fanOut: 0,
  downstream: 0,
  changeFreq: 0,
  ...over,
})

const P = (id: string, buildTime: number, over: Partial<GraphNode> = {}): GraphNode => ({
  id,
  band: 'external',
  kind: 'proc-macro',
  buildTime,
  fanIn: 1,
  fanOut: 0,
  downstream: 0,
  changeFreq: 0,
  ...over,
})

export const GRAPH_NODES: GraphNode[] = [
  // bins
  W({ id: 'gateway', band: 'bin', buildTime: 9.8, fanIn: 0, fanOut: 5, downstream: 0, changeFreq: 14 }),
  W({ id: 'api', band: 'bin', buildTime: 12.7, fanIn: 1, fanOut: 6, downstream: 0, changeFreq: 38, critical: true }),
  W({ id: 'worker', band: 'bin', buildTime: 11.2, fanIn: 0, fanOut: 5, downstream: 0, changeFreq: 21 }),
  W({ id: 'cli', band: 'bin', buildTime: 6.4, fanIn: 0, fanOut: 4, downstream: 0, changeFreq: 9 }),
  // libs
  W({ id: 'payments-core', buildTime: 10.4, fanIn: 2, fanOut: 5, downstream: 3, changeFreq: 17 }),
  W({ id: 'auth', buildTime: 7.1, fanIn: 2, fanOut: 3, downstream: 2, changeFreq: 8 }),
  W({ id: 'database', buildTime: 8.9, fanIn: 4, fanOut: 3, downstream: 6, changeFreq: 19 }),
  W({ id: 'http-client', buildTime: 5.2, fanIn: 3, fanOut: 3, downstream: 5, changeFreq: 6 }),
  W({ id: 'common-runtime', buildTime: 18.3, fanIn: 2, fanOut: 3, downstream: 38, changeFreq: 23, critical: true }),
  W({ id: 'telemetry', buildTime: 4.1, fanIn: 4, fanOut: 2, downstream: 9, changeFreq: 4 }),
  W({ id: 'cache', buildTime: 3.6, fanIn: 1, fanOut: 2, downstream: 1, changeFreq: 2 }),
  W({ id: 'config', buildTime: 2.2, fanIn: 2, fanOut: 1, downstream: 8, changeFreq: 3 }),
  W({ id: 'common', buildTime: 6.8, fanIn: 11, fanOut: 4, downstream: 41, changeFreq: 31, critical: true }),
  // external
  E('tokio', 8.2, { fanIn: 5, downstream: 41, versions: ['1.34.2', '1.40.0'], duplicate: true }),
  E('syn', 7.8, { fanIn: 4, downstream: 14, kind: 'external' }),
  E('serde', 6.1, { fanIn: 1, downstream: 41, versions: ['1.0.203', '1.0.210'], duplicate: true }),
  E('sqlx', 9.6, { fanIn: 1, downstream: 6 }),
  E('reqwest', 5.8, { fanIn: 1, downstream: 5 }),
  E('tracing', 2.4, { fanIn: 3, downstream: 12 }),
  E('tonic', 6.9, { fanIn: 1, downstream: 3 }),
  E('prost', 4.4, { fanIn: 1, downstream: 3 }),
  E('hyper', 5.3, { fanIn: 3, downstream: 5 }),
  E('tower', 3.2, { fanIn: 1, downstream: 5 }),
  E('rustls', 4.9, { fanIn: 2, downstream: 5 }),
  E('ring', 3.8, { fanIn: 2, downstream: 5 }),
  E('uuid', 2.1, { fanIn: 1, downstream: 41, versions: ['0.8.2', '1.8.0'], duplicate: true }),
  E('anyhow', 1.2, { fanIn: 1, downstream: 41 }),
  E('thiserror', 1.1, { fanIn: 1, downstream: 41 }),
  E('clap', 3.1, { fanIn: 1, downstream: 1 }),
  P('serde_derive', 5.4, { fanIn: 1, downstream: 41 }),
  P('tokio-macros', 2.8, { fanIn: 1, downstream: 41 }),
  P('sqlx-macros', 6.2, { fanIn: 1, downstream: 6 }),
  P('thiserror-impl', 1.4, { fanIn: 1, downstream: 41 }),
  P('clap_derive', 2.2, { fanIn: 1, downstream: 1 }),
  E('proc-macro2', 1.5, { fanIn: 4, downstream: 14 }),
  E('quote', 1.9, { fanIn: 4, downstream: 14 }),
]

export const GRAPH_EDGES: GraphEdge[] = [
  { from: 'gateway', to: 'api' },
  { from: 'gateway', to: 'auth' },
  { from: 'gateway', to: 'common' },
  { from: 'gateway', to: 'common-runtime' },
  { from: 'gateway', to: 'telemetry' },
  { from: 'api', to: 'payments-core' },
  { from: 'api', to: 'database' },
  { from: 'api', to: 'auth' },
  { from: 'api', to: 'common' },
  { from: 'api', to: 'telemetry' },
  { from: 'api', to: 'http-client' },
  { from: 'worker', to: 'payments-core' },
  { from: 'worker', to: 'database' },
  { from: 'worker', to: 'common' },
  { from: 'worker', to: 'telemetry' },
  { from: 'worker', to: 'cache' },
  { from: 'cli', to: 'config' },
  { from: 'cli', to: 'database' },
  { from: 'cli', to: 'common' },
  { from: 'cli', to: 'clap' },
  { from: 'payments-core', to: 'common' },
  { from: 'payments-core', to: 'database' },
  { from: 'payments-core', to: 'http-client' },
  { from: 'payments-core', to: 'common-runtime' },
  { from: 'payments-core', to: 'tonic' },
  { from: 'auth', to: 'common' },
  { from: 'auth', to: 'http-client' },
  { from: 'auth', to: 'telemetry' },
  { from: 'database', to: 'sqlx' },
  { from: 'database', to: 'common' },
  { from: 'database', to: 'config' },
  { from: 'http-client', to: 'reqwest' },
  { from: 'http-client', to: 'tower' },
  { from: 'http-client', to: 'common' },
  { from: 'common-runtime', to: 'tokio' },
  { from: 'common-runtime', to: 'tracing' },
  { from: 'common-runtime', to: 'telemetry' },
  { from: 'telemetry', to: 'tracing' },
  { from: 'telemetry', to: 'common' },
  { from: 'cache', to: 'tokio' },
  { from: 'cache', to: 'common' },
  { from: 'config', to: 'common' },
  { from: 'common', to: 'serde' },
  { from: 'common', to: 'thiserror' },
  { from: 'common', to: 'uuid' },
  { from: 'common', to: 'anyhow' },
  { from: 'sqlx', to: 'tokio' },
  { from: 'sqlx', to: 'sqlx-macros' },
  { from: 'reqwest', to: 'hyper' },
  { from: 'reqwest', to: 'rustls' },
  { from: 'reqwest', to: 'tokio' },
  { from: 'hyper', to: 'tokio' },
  { from: 'hyper', to: 'ring' },
  { from: 'rustls', to: 'ring' },
  { from: 'tonic', to: 'hyper' },
  { from: 'tonic', to: 'prost' },
  { from: 'tokio', to: 'tokio-macros' },
  { from: 'serde', to: 'serde_derive' },
  { from: 'thiserror', to: 'thiserror-impl' },
  { from: 'clap', to: 'clap_derive' },
  { from: 'serde_derive', to: 'syn' },
  { from: 'serde_derive', to: 'quote' },
  { from: 'tokio-macros', to: 'syn' },
  { from: 'sqlx-macros', to: 'syn' },
  { from: 'thiserror-impl', to: 'syn' },
  { from: 'clap_derive', to: 'syn' },
  { from: 'syn', to: 'proc-macro2' },
  { from: 'quote', to: 'proc-macro2' },
]

export const DUPLICATES: DuplicateGroup[] = [
  {
    name: 'tokio',
    versions: ['1.34.2', '1.40.0'],
    dependents: ['sqlx 0.7 (pinned)', 'legacy-cache'],
    wastedSeconds: 8.2,
  },
  {
    name: 'serde',
    versions: ['1.0.203', '1.0.210'],
    dependents: ['old-sdk 2.1', 'common (workspace)'],
    wastedSeconds: 6.1,
  },
  {
    name: 'uuid',
    versions: ['0.8.2', '1.8.0'],
    dependents: ['legacy-cache'],
    wastedSeconds: 2.1,
  },
]

export const BLAST: BlastEntry[] = [
  {
    file: 'common/src/error.rs',
    crate: 'common',
    affectedWorkspace: 41,
    chain: ['common', 'api', 'auth', 'gateway', 'worker', 'cli'],
    incrementalDelta: 12.8,
    suggestion: 'Move error abstractions into common-types (FER-WRK-007).',
  },
  {
    file: 'common-runtime/src/scheduler.rs',
    crate: 'common-runtime',
    affectedWorkspace: 38,
    chain: ['common-runtime', 'api', 'payments-core', 'gateway'],
    incrementalDelta: 18.3,
    suggestion: 'Split scheduler into runtime-telemetry (FER-BLD-001).',
  },
  {
    file: 'database/src/pool.rs',
    crate: 'database',
    affectedWorkspace: 22,
    chain: ['database', 'api', 'worker', 'cli', 'payments-core'],
    incrementalDelta: 9.6,
    suggestion: 'Isolate sqlx behind database-impl (see PR #184 suggestions).',
  },
  {
    file: 'api/src/routes.rs',
    crate: 'api',
    affectedWorkspace: 2,
    chain: ['api', 'gateway'],
    incrementalDelta: 13.1,
    suggestion: 'Cheap downstream — good place for iteration.',
  },
  {
    file: 'telemetry/src/otlp.rs',
    crate: 'telemetry',
    affectedWorkspace: 12,
    chain: ['telemetry', 'api', 'worker', 'gateway'],
    incrementalDelta: 4.4,
    suggestion: 'Consider feature-gating the OTLP exporter.',
  },
]

// ---------------------------------------------------------------------------
// Impact simulation catalogs
// ---------------------------------------------------------------------------

export const ADD_DEP_CATALOG: Record<
  string,
  {
    version: string
    cratesAdded: number
    procMacrosAdded: number
    targetMB: number
    cleanDelta: number
    incrementalDelta: number
    ciDelta: number
    transitiveDeps: number
    chain: { label: string; note?: string }[]
    security: { label: string; level: 'info' | 'warn' }[]
    suggestions: string[]
  }
> = {
  sqlx: {
    version: '0.8.6',
    cratesAdded: 14,
    procMacrosAdded: 3,
    targetMB: 28.4,
    cleanDelta: 4.7,
    incrementalDelta: 1.3,
    ciDelta: 21,
    transitiveDeps: 7,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +sqlx 0.8.6' },
      { label: 'sqlx', note: '+14 crates, +3 proc-macros' },
      { label: 'database', note: 'shared crate — highest blast radius' },
      { label: '18 downstream crates', note: 'full rebuild triggered' },
    ],
    security: [
      { label: '7 new transitive dependencies', level: 'info' },
      { label: 'sqlx-macros executes at build time — review build-script permissions', level: 'warn' },
    ],
    suggestions: [
      'Isolate sqlx behind a database-impl crate (keeps types clean)',
      'Enable only runtime-tokio-rustls features to shrink the tree',
      'Gate behind an optional feature until the retry layer lands',
    ],
  },
  'aws-sdk-s3': {
    version: '1.62.0',
    cratesAdded: 31,
    procMacrosAdded: 2,
    targetMB: 52.1,
    cleanDelta: 6.9,
    incrementalDelta: 2.2,
    ciDelta: 38,
    transitiveDeps: 24,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +aws-sdk-s3 1.62.0' },
      { label: 'aws-smithy stack', note: '+24 transitive crates' },
      { label: 'hyper/rustls', note: 'shared — already compiled' },
      { label: 'CI', note: '+38s per clean pipeline' },
    ],
    security: [
      { label: '24 new transitive dependencies', level: 'info' },
      { label: 'Large artifact footprint: +52.1 MB target size', level: 'warn' },
    ],
    suggestions: [
      'Wrap in a storage abstraction crate to contain the blast radius',
      'Disable unneeded behaviors (default-features = false)',
      'Consider presigned URLs via a thin client instead of the full SDK',
    ],
  },
  reqwest: {
    version: '0.12.9',
    cratesAdded: 11,
    procMacrosAdded: 1,
    targetMB: 12.7,
    cleanDelta: 2.8,
    incrementalDelta: 0.9,
    ciDelta: 14,
    transitiveDeps: 9,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +reqwest 0.12.9' },
      { label: 'hyper 1.x', note: 'new major — coexists with 0.14' },
      { label: 'rustls', note: 'shared with existing http-client' },
    ],
    security: [
      { label: '9 new transitive dependencies', level: 'info' },
      { label: 'Prefer rustls feature to avoid OpenSSL linkage', level: 'info' },
    ],
    suggestions: [
      'Reuse http-client instead of adding a second HTTP stack',
      'If required, enable json + rustls features only',
    ],
  },
  tonic: {
    version: '0.12.3',
    cratesAdded: 9,
    procMacrosAdded: 1,
    targetMB: 15.2,
    cleanDelta: 3.4,
    incrementalDelta: 1.1,
    ciDelta: 17,
    transitiveDeps: 11,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +tonic 0.12.3' },
      { label: 'prost', note: '+codegen at build time' },
      { label: 'hyper/tower', note: 'shared' },
    ],
    security: [{ label: '11 new transitive dependencies', level: 'info' }],
    suggestions: [
      'Keep proto codegen in a dedicated crate with build.rs isolation',
      'Share one tonic version across services via workspace.dependencies',
    ],
  },
  'opentelemetry-otlp': {
    version: '0.27.0',
    cratesAdded: 22,
    procMacrosAdded: 2,
    targetMB: 34.8,
    cleanDelta: 5.1,
    incrementalDelta: 1.8,
    ciDelta: 29,
    transitiveDeps: 18,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +opentelemetry-otlp 0.27' },
      { label: 'tonic + tracing-opentelemetry', note: 'overlaps telemetry crate' },
      { label: 'CI', note: '+29s per clean pipeline' },
    ],
    security: [
      { label: '18 new transitive dependencies', level: 'info' },
      { label: 'Feature matrix can duplicate opentelemetry builds — unify versions', level: 'warn' },
    ],
    suggestions: [
      'Integrate through the existing telemetry crate, not application crates',
      'Feature-gate the OTLP exporter behind telemetry-otlp',
    ],
  },
  'deadpool-redis': {
    version: '0.18.0',
    cratesAdded: 6,
    procMacrosAdded: 0,
    targetMB: 4.2,
    cleanDelta: 1.1,
    incrementalDelta: 0.4,
    ciDelta: 6,
    transitiveDeps: 4,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +deadpool-redis 0.18' },
      { label: 'redis crate', note: '+4 transitive' },
      { label: 'cache', note: 'natural owner for this dependency' },
    ],
    security: [{ label: '4 new transitive dependencies', level: 'info' }],
    suggestions: ['Add it inside the cache crate to keep fan-out low'],
  },
}

export const SPLIT_SIM = {
  source: 'common',
  before: {
    buildSeconds: 42.1,
    fanOut: 11,
    downstream: 41,
    modules: ['types', 'database', 'http', 'auth', 'utilities'],
  },
  proposal: {
    crates: [
      { name: 'common-types', downstream: 41, buildSeconds: 8.4, modules: ['types', 'error', 'ids'] },
      { name: 'common-db', downstream: 12, buildSeconds: 11.2, modules: ['database', 'pool'] },
      { name: 'common-http', downstream: 9, buildSeconds: 9.6, modules: ['http', 'middleware'] },
    ],
    buildSeconds: 29.2,
  },
  improvementPct: 30.6,
  migration: [
    'Create common-types with pure data + error abstractions (no IO)',
    'Re-point fan-out-heavy crates to common-types first (api, gateway)',
    'Move database + pool modules into common-db behind a trait',
    'Extract http middleware into common-http',
    'Verify: blast radius of common/src/error.rs drops 41 → ≤12 crates',
  ],
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export const DIAGNOSTICS: DiagnosticsPayload = {
  borrow: {
    error: 'error[E0502]: cannot borrow `user` as mutable because it is also borrowed as immutable',
    code: [
      'fn main() {',
      '    let mut user = User { name: "alice".into(), score: 10 };',
      '',
      '    let name_ref = &user.name;      // shared borrow created',
      '    user.promote();                  // ✗ mutable borrow attempted',
      '    println!("{name_ref}");          // name_ref used again here',
      '}',
      '',
      'impl User {',
      '    fn promote(&mut self) { self.score += 1; }',
      '}',
    ],
    narrative:
      'Rust prevents B because A may still be used afterwards. The shared borrow name_ref is created at line 4 and its last use is line 6 — so it must live across the mutable borrow at line 5. Two live borrows of the same data cannot overlap when one is mutable.',
    steps: [
      {
        id: 1,
        line: 4,
        title: 'Shared borrow created',
        detail:
          'name_ref = &user.name creates an immutable reference. From this point, the compiler tracks name_ref\u2019s live range.',
        lifetime: { label: 'name_ref (shared)', start: 4, end: 6, kind: 'shared' },
      },
      {
        id: 2,
        line: 5,
        title: 'Mutable borrow attempted',
        detail:
          'user.promote() needs &mut user. A mutable borrow requires exclusive access — no other live borrows may exist.',
        lifetime: { label: 'promote → &mut user', start: 5, end: 5, kind: 'conflict' },
      },
      {
        id: 3,
        line: 6,
        title: 'Last use of the shared borrow',
        detail:
          'println! uses name_ref. Under NLL, the borrow must stay alive until its last use — which is here, after the conflicting mutable borrow.',
        lifetime: { label: 'name_ref (shared)', start: 4, end: 6, kind: 'shared' },
      },
      {
        id: 4,
        line: 5,
        title: 'Overlap rejected',
        detail:
          'The shared borrow\u2019s lifetime [4..6] overlaps the mutable borrow at line 5. Rust rejects the program to prevent aliasing mutation — this is a soundness guarantee, not a style rule.',
        lifetime: { label: 'conflict region', start: 5, end: 5, kind: 'mutable' },
      },
    ],
    timelineTicks: ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7'],
    solutions: [
      {
        title: "1. Shorten the borrow's lifetime",
        code: 'let name = user.name.clone();\nuser.promote();\nprintln!("{name}");',
        tradeOff: 'One extra allocation; zero aliasing. Usually the cheapest correct fix.',
      },
      {
        title: '2. Move the last use earlier',
        code: 'let name_ref = &user.name;\nprintln!("{name_ref}");\nuser.promote();',
        tradeOff: 'No allocation. Works when usage order is flexible.',
      },
      {
        title: '3. Restructure the scope',
        code: '{\n    let name_ref = &user.name;\n    println!("{name_ref}");\n}\nuser.promote();',
        tradeOff: 'Explicit scoping documents intent; no runtime cost.',
      },
      {
        title: '4. Use owned data / indices',
        code: 'user.promote();\nprintln!("{}", user.name);',
        tradeOff: 'Borrow disappears entirely; best when the reference is unnecessary.',
      },
    ],
  },
  request: {
    id: '8F31',
    method: 'POST',
    path: '/payments',
    totalMs: 42.8,
    segments: [
      { id: 'auth', label: 'authentication', startMs: 0, durationMs: 1.4, kind: 'compute', span: 'auth::verify' },
      { id: 'valid', label: 'validation', startMs: 1.4, durationMs: 0.8, kind: 'compute', span: 'api::validate' },
      { id: 'db', label: 'database', startMs: 2.2, durationMs: 7.3, kind: 'db', span: 'sqlx::query — accounts' },
      { id: 'prov', label: 'payment provider', startMs: 2.2, durationMs: 31.7, kind: 'network', span: 'http-client — POST /charge', note: 'ran concurrently with DB query' },
      { id: 'bg', label: 'background task', startMs: 41.2, durationMs: 1.6, kind: 'background', span: 'worker::flush — queue', note: 'spawned after response decision' },
    ],
    tasks: [
      { id: 'T1', label: 'handler task', state: 'running', detail: 'POST /payments — owns request scope' },
      { id: 'T2', label: 'db query task', parent: 'T1', state: 'awaited', detail: 'select account — awaited via join!' },
      { id: 'T3', label: 'provider call task', parent: 'T1', state: 'resumed', detail: '31.7ms external HTTP — resumed twice' },
      { id: 'T4', label: 'queue flush task', parent: 'T1', state: 'done', detail: 'spawned near response; detached' },
      { id: 'T5', label: 'scan task (worker)', state: 'blocked', detail: 'std::fs read_dir inside async fn — blocks worker thread (FER-ASY-012)' },
    ],
    warnings: [
      'provider call dominates: 74% of request latency is external I/O',
      'worker thread stall 340ms p95 detected during scan task (FER-ASY-012)',
    ],
  },
}

// ---------------------------------------------------------------------------
// PR regression analysis
// ---------------------------------------------------------------------------

export const PR_184: PRAnalysis = {
  number: 184,
  title: 'feat(db): add persistence retry layer',
  author: 'mgarret',
  branch: 'feat/db-retry',
  base: 'main',
  before: 31.2,
  after: 44.8,
  regressionPct: 43.6,
  affectedCrates: 18,
  confidence: 91,
  confidenceClass: 'high',
  causeChain: [
    { label: 'database/Cargo.toml', note: '+ sqlx 0.8 with default features', kind: 'dep' },
    { label: 'sqlx', note: '+14 crates, +3 proc-macros', kind: 'proc-macro' },
    { label: 'database crate', note: '+6.1s compile time', kind: 'crate' },
    { label: '18 downstream crates', note: 'full rebuild on every database change', kind: 'fanout' },
  ],
  comment:
    '⚠ **Build Performance Regression**\n\nThis PR increases estimated incremental build time by **43.6%** (31.2s → 44.8s).\n\n**Primary cause:** `database → sqlx` dependency expansion with default features enabled.\n\n**Evidence:**\n- `Cargo.lock`: +14 crates, +3 proc-macro crates\n- `cargo build --timings`: database 6.1s → 12.2s\n- Blast radius: 18 downstream crates re-invalidate on `database` changes\n\n**Suggested alternatives:**\n1. Isolate sqlx behind a `database-impl` crate\n2. Split database types from implementation\n3. Reduce enabled sqlx features (`runtime-tokio-rustls` only)\n\n_Estimated values — not verified until an experiment is run._',
  suggestions: [
    {
      title: 'Isolate sqlx behind database-impl',
      detail: 'Keep sqlx and its proc-macros out of the public API of database.',
      estimatedSaving: '≈ −8.4s incremental for 16 downstream crates',
    },
    {
      title: 'Split database types from implementation',
      detail: 'Move DTOs and error types into database-types (no sqlx dependency).',
      estimatedSaving: '≈ −5.2s for 12 downstream crates',
    },
    {
      title: 'Reduce sqlx features',
      detail: 'default-features = false, features = ["runtime-tokio-rustls", "postgres"].',
      estimatedSaving: '≈ −3.1s clean build',
    },
  ],
  checks: [
    { name: 'ferrix/build-impact', status: 'fail', duration: '12s' },
    { name: 'ferrix/graph-diff', status: 'pass', duration: '8s' },
    { name: 'ferrix/evidence-lint', status: 'pass', duration: '2s' },
    { name: 'ci/build', status: 'pass', duration: '4m12s' },
    { name: 'ci/test', status: 'pass', duration: '6m48s' },
  ],
  files: [
    { name: 'database/Cargo.toml', additions: 4, deletions: 1 },
    { name: 'database/src/retry.rs', additions: 214, deletions: 0 },
    { name: 'database/src/pool.rs', additions: 38, deletions: 12 },
    { name: 'Cargo.lock', additions: 96, deletions: 2 },
  ],
}

// ---------------------------------------------------------------------------
// Experiments (Gate 20)
// ---------------------------------------------------------------------------

const EXP_STAGES_VERIFIED = [
  { name: 'plan', state: 'done' as const },
  { name: 'baseline', state: 'done' as const },
  { name: 'candidate', state: 'done' as const },
  { name: 'cargo check', state: 'done' as const },
  { name: 'cargo test', state: 'done' as const },
  { name: 'benchmark', state: 'done' as const },
  { name: 'compare', state: 'done' as const },
  { name: 'report', state: 'done' as const },
]

const EXP_STAGES_RUNNING = [
  { name: 'plan', state: 'done' as const },
  { name: 'baseline', state: 'done' as const },
  { name: 'candidate', state: 'active' as const },
  { name: 'cargo check', state: 'pending' as const },
  { name: 'cargo test', state: 'pending' as const },
  { name: 'benchmark', state: 'pending' as const },
  { name: 'compare', state: 'pending' as const },
  { name: 'report', state: 'pending' as const },
]

const EXP_STAGES_DRAFT = [
  { name: 'plan', state: 'done' as const },
  { name: 'baseline', state: 'pending' as const },
  { name: 'candidate', state: 'pending' as const },
  { name: 'cargo check', state: 'pending' as const },
  { name: 'cargo test', state: 'pending' as const },
  { name: 'benchmark', state: 'pending' as const },
  { name: 'compare', state: 'pending' as const },
  { name: 'report', state: 'pending' as const },
]

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'EXP-014',
    title: 'Split common-runtime into core + telemetry',
    findingId: 'FER-BLD-001',
    commit: 'a3f19c2',
    status: 'verified',
    claim: 'verified',
    baseline: { seconds: 42.1, runs: 5, measuredAt: '2026-09-10T14:02:00Z' },
    candidate: { seconds: 31.8, runs: 5, measuredAt: '2026-09-12T09:41:00Z' },
    improvementPct: 24.5,
    tests: { passed: 1842, failed: 0 },
    environment: {
      toolchain: 'rustc 1.84.1',
      os: 'linux-x86_64',
      profile: 'dev',
      cache: 'cold (sccache disabled)',
    },
    commands: [
      'ferrix experiment create --from FER-BLD-001',
      'ferrix experiment baseline EXP-014 --runs 5',
      'git apply candidate.patch && cargo check',
      'cargo test --workspace',
      'ferrix experiment compare EXP-014',
    ],
    stages: EXP_STAGES_VERIFIED,
    conclusion:
      'Verified improvement: 24.5% (measured, 5-run median, reproduced ×2 on clean environments). Baseline 42.1s → candidate 31.8s, 1,842 tests passed.',
  },
  {
    id: 'EXP-015',
    title: 'Unify duplicate tokio versions',
    findingId: 'FER-BLD-002',
    commit: '77bd0e4',
    status: 'running',
    claim: 'measured',
    baseline: { seconds: 87.4, runs: 3, measuredAt: '2026-09-15T11:20:00Z' },
    candidate: null,
    improvementPct: null,
    tests: null,
    environment: {
      toolchain: 'rustc 1.84.1',
      os: 'linux-x86_64',
      profile: 'dev',
      cache: 'cold',
    },
    commands: [
      'ferrix experiment create --from FER-BLD-002',
      'ferrix experiment baseline EXP-015 --runs 3',
      'cargo update -p tokio@1.34.2 --precise 1.40.0  # candidate, pending',
    ],
    stages: EXP_STAGES_RUNNING,
  },
  {
    id: 'EXP-016',
    title: 'Isolate sqlx behind database-impl',
    findingId: 'FER-WRK-007',
    commit: 'e91f7aa',
    status: 'draft',
    claim: 'estimated',
    baseline: null,
    candidate: null,
    improvementPct: null,
    tests: null,
    environment: {
      toolchain: 'rustc 1.84.1',
      os: 'linux-x86_64',
      profile: 'dev',
      cache: 'cold',
    },
    commands: ['ferrix experiment create --from FER-WRK-007  # plan drafted, awaiting approval'],
    stages: EXP_STAGES_DRAFT,
  },
]

// ---------------------------------------------------------------------------
// Release scorecard
// ---------------------------------------------------------------------------

export const GATES = {
  verdict: 'CONDITIONAL GO' as const,
  rationale:
    'All release-blocking gates pass. Two non-blocking gates remain conditional: doctor p95 on the medium fixture is 12.4s against the 10s target (profiling issue assigned), and the 10-developer usability study is scheduled for next sprint. Ship is permitted with documented mitigation.',
  gates: [
    { id: 1, name: 'Installation & clean environment', objective: 'Clean install, ferrix --version, doctor boots', target: '100% clean-env success', measured: '100% (12/12 CI matrix runs)', status: 'pass', evidence: 'install-matrix job · all supported environments', blocking: true },
    { id: 2, name: 'Repository & Cargo discovery', objective: 'Correct metadata ingestion', target: '≥99.5% agreement · 0 graph errors', measured: '99.7% · 0 unexplained errors', status: 'pass', evidence: 'fixture suite ×10 repos vs cargo metadata', blocking: true },
    { id: 3, name: 'F-EIR snapshot integrity', objective: 'Valid, versioned, deterministic snapshots', target: '100% schema-valid · deterministic', measured: '100% · identical-input equivalence proven', status: 'pass', evidence: 'golden snapshot tests · schema v4', blocking: true },
    { id: 4, name: 'Incremental analysis', objective: 'Local changes invalidate locally', target: '≥95% work reduction', measured: '96.8% on 100-crate fixture', status: 'pass', evidence: 'invalidation benchmark · 1-file change', blocking: false },
    { id: 5, name: 'Engineering graph relationships', objective: 'Blast radius, critical path, git association', target: '100% on deterministic fixtures', measured: '100% (61/61 fixture cases)', status: 'pass', evidence: 'graph fixture corpus', blocking: true },
    { id: 6, name: 'Build intelligence accuracy', objective: 'Telemetry ingestion without silent loss', target: '≥99% event ingestion', measured: '99.4% (8,412/8,464 events)', status: 'pass', evidence: 'build event ingestion tests incl. failed builds', blocking: false },
    { id: 7, name: 'Finding quality & evidence', objective: 'Stable IDs, evidence, calibrated confidence', target: '≥90% precision · 100% evidence', measured: '93% precision · 100% evidence traceability', status: 'pass', evidence: 'false-positive fixture suite (12 analyzers)', blocking: true },
    { id: 8, name: 'Doctor actionability', objective: 'What/Why/Evidence/Impact/Recommendation/Verification', target: '100% actionable findings carry remediation', measured: '100% (12/12 findings)', status: 'pass', evidence: 'doctor output schema validation', blocking: true },
    { id: 9, name: 'AI grounding & safety', objective: 'AI never overrides evidence · fully optional', target: '0 grounding violations', measured: '0/240 adversarial prompts contradict evidence', status: 'pass', evidence: 'adversarial suite · AI-off deterministic run identical', blocking: true },
    { id: 10, name: 'Patch & experiment safety', objective: 'No silent modification · full experiment metadata', target: '100% reviewable diffs · metadata complete', measured: '100% (37 experiments audited)', status: 'pass', evidence: 'patch pipeline audit', blocking: true },
    { id: 11, name: 'CLI contract', objective: 'Exit codes + --json everywhere', target: '100% contract tests', measured: '100% (0/4/1/2 exit matrix covered)', status: 'pass', evidence: 'cli-contract test suite', blocking: false },
    { id: 12, name: 'Performance & memory', objective: 'Startup <150ms · incremental <1s · doctor <10s · idle <100MB', target: 'All budgets met', measured: 'startup 84ms · incremental 0.6s · doctor p95 12.4s · idle 61MB', status: 'conditional', evidence: 'doctor p95 exceeds target on medium fixture — profiling issue FER-114, owner: compiler-perf team', blocking: false },
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
    { condition: 'Unbounded disk growth', clear: true, note: 'ferrix storage + retention GC verified' },
    { condition: 'Major unexplained performance regression', clear: true, note: 'benchmark suite green; doctor p95 gap documented (FER-114)' },
    { condition: 'Findings without evidence', clear: true, note: 'schema enforces evidence array on all findings' },
    { condition: 'Estimated results presented as verified', clear: true, note: 'measurement-status labels enforced in output schema' },
    { condition: 'Broken machine-readable CLI contracts', clear: true, note: 'exit-code + --json matrix 100% green' },
    { condition: 'Failed end-to-end MVP workflow', clear: true, note: '20-step e2e acceptance passing' },
  ],
}

// ---------------------------------------------------------------------------
// Issues → PRs traceability
// ---------------------------------------------------------------------------

export const ISSUES: IssueItem[] = [
  {
    id: 'FER-101',
    ghIssue: 1,
    title: 'App shell, F-EIR data layer & rust-intelligence theme',
    gate: 'Gate 3 · F-EIR',
    labels: ['foundation', 'frontend'],
    state: 'merged',
    pr: {
      number: 10,
      branch: 'feat/app-shell-feir-foundation',
      title: 'feat: app shell + F-EIR data layer',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'evidence-lint', status: 'pass' },
      ],
      additions: 1240,
      deletions: 18,
    },
    verification: 'lint clean · dev server 200 · all 9 API routes serve valid JSON',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-102',
    ghIssue: 2,
    title: 'Engineering Health overview dashboard',
    gate: 'Gate 6 · Build intelligence',
    labels: ['frontend', 'dashboard'],
    state: 'merged',
    pr: {
      number: 11,
      branch: 'feat/overview-dashboard',
      title: 'feat: engineering health overview',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 620,
      deletions: 6,
    },
    verification: 'KPI grid + trend charts render with live API data',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-103',
    ghIssue: 3,
    title: 'ferrix doctor — evidence-backed findings with confidence calibration',
    gate: 'Gate 8 · Doctor actionability',
    labels: ['frontend', 'doctor'],
    state: 'merged',
    pr: {
      number: 12,
      branch: 'feat/build-doctor',
      title: 'feat: build doctor with evidence & confidence',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'gate-8-schema', status: 'pass' },
      ],
      additions: 840,
      deletions: 4,
    },
    verification: '12/12 findings carry evidence + remediation + verification path',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-104',
    ghIssue: 4,
    title: 'Engineering graph & dependency blast radius',
    gate: 'Gate 5 · Graph relationships',
    labels: ['frontend', 'graph'],
    state: 'merged',
    pr: {
      number: 13,
      branch: 'feat/dependency-graph',
      title: 'feat: engineering graph + blast radius',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'blast-radius-fixture', status: 'pass' },
      ],
      additions: 910,
      deletions: 5,
    },
    verification: 'traversal matches fixture expectation (100%) on 5 blast cases',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-105',
    ghIssue: 5,
    title: 'Impact simulator — add-dep / edit-file / split-crate',
    gate: 'Gate 10 · Estimated vs verified',
    labels: ['frontend', 'simulator'],
    state: 'merged',
    pr: {
      number: 14,
      branch: 'feat/impact-simulator',
      title: 'feat: engineering cost calculator + architecture simulator',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 700,
      deletions: 3,
    },
    verification: 'all estimates labeled "estimated", never "measured"',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-106',
    ghIssue: 6,
    title: 'Diagnostics — borrow-checker explainer & async flow inspector',
    gate: 'Gate 8 · Actionability',
    labels: ['frontend', 'diagnostics'],
    state: 'merged',
    pr: {
      number: 15,
      branch: 'feat/diagnostics',
      title: 'feat: borrow explainer + async flow',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 760,
      deletions: 2,
    },
    verification: 'step-through walkthrough renders; async waterfall matches telemetry fixture',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-107',
    ghIssue: 7,
    title: 'PR build-regression analysis (PR #184)',
    gate: 'Gate 6 · Build intelligence',
    labels: ['frontend', 'ci'],
    state: 'merged',
    pr: {
      number: 16,
      branch: 'feat/pr-regression',
      title: 'feat: PR regression report + bot comment preview',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 540,
      deletions: 2,
    },
    verification: 'before/after bars, cause chain, checks table render',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-108',
    ghIssue: 8,
    title: 'Experiment engine — baseline/candidate/verified loop',
    gate: 'Gate 20 · Value loop',
    labels: ['frontend', 'experiments'],
    state: 'merged',
    pr: {
      number: 17,
      branch: 'feat/experiment-engine',
      title: 'feat: experiment engine UI',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'experiment-schema', status: 'pass' },
      ],
      additions: 620,
      deletions: 2,
    },
    verification: 'EXP-014 shows verified 24.5% with full metadata; running/draft states distinct',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-109',
    ghIssue: 9,
    title: 'Release scorecard + issues/PRs traceability board',
    gate: 'Gates 71.48–71.51 · Release decision',
    labels: ['frontend', 'governance'],
    state: 'merged',
    pr: {
      number: 18,
      branch: 'feat/scorecard-issues',
      title: 'feat: release scorecard + issue/PR board',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 580,
      deletions: 2,
    },
    verification: '20 gates, 17 blocking conditions, GO decision rendered with evidence',
    repoUrl: REPO_URL,
  },
]

// ---------------------------------------------------------------------------
// Overview / health
// ---------------------------------------------------------------------------

export const HEALTH: HealthPayload = {
  workspace: WORKSPACE.name,
  crates: WORKSPACE.crates,
  edges: WORKSPACE.edges,
  toolchain: WORKSPACE.toolchain,
  cacheHitRate: 32,
  kpis: {
    buildPerformance: { delta: -23, label: 'Build performance' },
    ciCost: { delta: -18, label: 'CI cost' },
    dependencyRisk: { delta: -14, label: 'Dependency risk' },
    prRegressions: { count: 2, label: 'PR build regressions' },
    architectureDebt: { count: 17, label: 'Architecture debt' },
    runtimeBottlenecks: { count: 6, label: 'Runtime bottlenecks' },
  },
  buildTrend: [
    { month: 'Apr', clean: 64.2, incremental: 8.2 },
    { month: 'May', clean: 71.0, incremental: 9.1 },
    { month: 'Jun', clean: 78.3, incremental: 11.8 },
    { month: 'Jul', clean: 82.6, incremental: 13.5 },
    { month: 'Aug', clean: 85.9, incremental: 15.2 },
    { month: 'Sep', clean: 87.4, incremental: 16.9 },
  ],
  slowestCrates: [
    { name: 'common-runtime', seconds: 18.3, downstream: 38 },
    { name: 'api', seconds: 12.7, downstream: 0 },
    { name: 'worker', seconds: 11.2, downstream: 0 },
    { name: 'payments-core', seconds: 10.4, downstream: 3 },
    { name: 'gateway', seconds: 9.8, downstream: 0 },
    { name: 'database', seconds: 8.9, downstream: 6 },
  ],
  activity: [
    {
      id: 'a1',
      time: '2m ago',
      kind: 'regression',
      title: 'PR #184 build regression detected',
      detail: '+43.6% incremental build (31.2s → 44.8s) — sqlx dependency expansion',
      severity: 'critical',
    },
    {
      id: 'a2',
      time: '1h ago',
      kind: 'duplicate',
      title: 'Duplicate tokio versions after lockfile update',
      detail: '1.34.2 + 1.40.0 both compiled — FER-BLD-002',
      severity: 'warning',
    },
    {
      id: 'a3',
      time: '3h ago',
      kind: 'amplification',
      title: 'common-runtime change amplified ×38 rebuilds',
      detail: 'scheduler.rs touched; 38 crates re-invalidated — FER-BLD-001',
      severity: 'warning',
    },
    {
      id: 'a4',
      time: 'yesterday',
      kind: 'experiment',
      title: 'EXP-014 verified: 24.5% build improvement',
      detail: 'common-runtime split measured 42.1s → 31.8s (5-run median)',
      severity: 'info',
    },
    {
      id: 'a5',
      time: '2d ago',
      kind: 'improvement',
      title: 'CI cache miss rate 68% → 54%',
      detail: 'cargo-chef migration on 2 of 5 pipelines — FER-DEP-006',
      severity: 'info',
    },
    {
      id: 'a6',
      time: '3d ago',
      kind: 'config',
      title: 'rust-analyzer flycheck config applied',
      detail: 'check.workspace=false rolled out to 12 developers — FER-IDE-010',
      severity: 'info',
    },
  ],
  findingCounts: [
    { section: 'Build', count: 4 },
    { section: 'Workspace', count: 3 },
    { section: 'CI', count: 2 },
    { section: 'IDE', count: 2 },
    { section: 'Async', count: 1 },
  ],
  lastScan: WORKSPACE.lastScan,
}
