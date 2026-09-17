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
  AddDepImpact,
  EditFileImpact,
  ExperimentsPayload,
  GraphPayload,
  SplitImpact,
  WorkspaceSummary,
  WorkspacesPayload,
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
    experimentEligible: true,
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
    experimentEligible: true,
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
  criticalPathExplanation: 'common-runtime blocks 41 crates; split proposal verified in EXP-014',
  criticalPathCaption:
    'proc-macro chain = syn + quote + proc-macro2 compiled in 3 version sets (FER-BLD-004) · linking includes codegen',
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
  {
    id: 'FER-110',
    ghIssue: 19,
    title: 'Round 2 — ⌘K command palette, ferrix storage report, styling pass',
    gate: 'Gate 71.10 · Storage',
    labels: ['frontend', 'governance'],
    state: 'merged',
    pr: {
      number: 20,
      branch: 'feat/round2-palette-storage-polish',
      title: 'feat: command palette + storage report + polish',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 640,
      deletions: 24,
    },
    verification: '⌘K palette navigates all views · storage dialog bounded/inspectable · QA sweep error-free',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-111',
    ghIssue: 25,
    title: 'Finding detail drawer — drill into any FER-xxx finding',
    gate: 'Gate 8 · Actionability',
    labels: ['frontend', 'doctor'],
    state: 'merged',
    pr: {
      number: 29,
      branch: 'feat/finding-sheet-real',
      title: 'feat: finding detail drawer implementation',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 281,
      deletions: 7,
    },
    verification: 'drawer opens from every finding card · Escape/overlay close · keyboard accessible',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-112',
    ghIssue: 26,
    title: 'sccache build-economics simulator in ferrix doctor',
    gate: 'Gate 6 · Build intelligence',
    labels: ['frontend', 'doctor', 'simulation'],
    state: 'merged',
    pr: {
      number: 30,
      branch: 'feat/round3-sccache',
      title: 'feat: sccache build-economics simulator',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 228,
      deletions: 0,
    },
    verification: 'slider recomputes model live · linker never cached · outputs labeled estimated (Gate 21)',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-113',
    ghIssue: 27,
    title: 'Release scorecard export — versioned JSON & markdown',
    gate: 'Gates 11/28 · CLI contract',
    labels: ['frontend', 'governance'],
    state: 'merged',
    pr: {
      number: 31,
      branch: 'feat/round3-scorecard-export',
      title: 'feat: scorecard export (JSON/MD) + FER-111..113 board rows',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 195,
      deletions: 10,
    },
    verification: 'exported JSON parses and round-trips the payload · markdown mirrors verdict + gates',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-114',
    ghIssue: 34,
    title: 'Functional workspace switcher — per-workspace datasets',
    gate: 'Gate 21 · Honest measurement scope',
    labels: ['frontend', 'api', 'workspaces'],
    state: 'merged',
    pr: {
      number: 35,
      branch: 'feat/round4-workspace-switcher',
      title: 'feat: workspace switcher with per-workspace datasets',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 1039,
      deletions: 122,
    },
    verification: 'helios ⇄ atlas round-trip on overview/doctor/graph/simulator/experiments · persisted selection',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-115',
    ghIssue: 37,
    title: 'Doctor scan history — event-driven scan + persisted run log',
    gate: 'Gate 21 · Honest measurement scope',
    labels: ['frontend', 'build-doctor'],
    state: 'merged',
    pr: {
      number: 40,
      branch: 'feat/round5-scan-diff',
      title: 'feat: doctor scan history + reviewable diff queue (Gate 19 flow)',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 780,
      deletions: 18,
    },
    verification: 'topbar/⌘K scan bumps global event → doctor replays + records history · trend bars + trigger labels verified',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-116',
    ghIssue: 38,
    title: 'Diff review queue — close the Gate-19 loop',
    gate: 'Gate 19 · No silent modification',
    labels: ['frontend', 'governance'],
    state: 'merged',
    pr: {
      number: 40,
      branch: 'feat/round5-scan-diff',
      title: 'feat: doctor scan history + reviewable diff queue (Gate 19 flow)',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 780,
      deletions: 18,
    },
    verification: 'Queue-as-diff lands real per-workspace entries · pending badge · copy/mark-applied(dismiss)/re-open verified',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-117',
    ghIssue: 42,
    title: 'Unified-diff .patch generator for proposed changes',
    gate: 'Gate 19 · No silent modification',
    labels: ['frontend', 'governance'],
    state: 'merged',
    pr: {
      number: 45,
      branch: 'feat/round6-patch-generator',
      title: 'feat: unified-diff .patch export for the diff queue (issue #42)',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 210,
      deletions: 8,
    },
    verification: 'per-entry .patch + Download-all bundle · git apply --numstat parses both · new-proposal semantics (no fabricated context)',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-118',
    ghIssue: 43,
    title: 'Light-mode tokens + appearance toggle',
    gate: 'Gate 21 · Honest measurement scope',
    labels: ['frontend', 'theme'],
    state: 'merged',
    pr: {
      number: 47,
      branch: 'feat/round6-light-mode',
      title: 'feat: warm-paper light mode via palette overrides + next-themes toggle (issue #43)',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 190,
      deletions: 30,
    },
    verification: 'toggle + ⌘K action · persists across reload · 0 hydration warnings · mobile light QA + natural footer push verified',
    repoUrl: REPO_URL,
  },
  {
    id: 'FER-119',
    ghIssue: 44,
    title: 'Scan history — duration trend + JSON/Markdown export',
    gate: 'Gate 11 · Human/JSON equivalence',
    labels: ['frontend', 'build-doctor'],
    state: 'merged',
    pr: {
      number: 46,
      branch: 'feat/round6-scan-history-export',
      title: 'feat: findings|duration trend toggle + scan-history export (issue #44)',
      checks: [
        { name: 'lint', status: 'pass' },
        { name: 'browser-qa', status: 'pass' },
      ],
      additions: 240,
      deletions: 20,
    },
    verification: 'finds|time segmented toggle (avg/peak footer) · ferrix.scan-history/v1 JSON + MD run-table downloads verified',
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
  insight: {
    text: 'Average PR now causes 4.7× more compilation work than six months ago.',
    question: 'Why has compilation work per PR grown?',
  },
}

// ---------------------------------------------------------------------------
// Workspace registry + second workspace (atlas-consortium) — issue #34
// ---------------------------------------------------------------------------

export const WORKSPACE_ATLAS = {
  name: 'atlas-consortium',
  description: 'Data infrastructure consortium · 23 workspace crates · rustc 1.83.0 · dev profile',
  crates: 23,
  backboneNodes: 24,
  edges: 96,
  toolchain: 'rustc 1.83.0 (9b1d2c4) · cargo 1.83.0',
  profile: 'dev',
  lastScan: '2026-09-17T08:41:37Z',
}

export const WORKSPACES: WorkspaceSummary[] = [
  {
    id: 'helios-platform',
    name: 'helios-platform',
    description: 'Payments platform · continuously analyzed',
    crates: WORKSPACE.crates,
    edges: WORKSPACE.edges,
    toolchain: WORKSPACE.toolchain,
    accent: 'primary',
    status: 'live',
    findings: FINDINGS.length,
    lastScan: WORKSPACE.lastScan,
  },
  {
    id: 'atlas-consortium',
    name: 'atlas-consortium',
    description: 'Data infrastructure · continuously analyzed',
    crates: WORKSPACE_ATLAS.crates,
    edges: WORKSPACE_ATLAS.edges,
    toolchain: WORKSPACE_ATLAS.toolchain,
    accent: 'emerald',
    status: 'live',
    findings: 7,
    lastScan: WORKSPACE_ATLAS.lastScan,
  },
]

export const WORKSPACES_DEFAULT = WORKSPACES[0].id

// ------------------------------------------------------------- atlas: doctor

const ATLAS_FINDINGS: Finding[] = [
  {
    id: 'ATL-BLD-001',
    section: 'Build',
    severity: 'critical',
    title: 'atlas-store dominates the critical path',
    description:
      'atlas-store compiles 14.2s of the 52.8s dev build — its LSM tree modules changed 41 times in 90 days, so the most expensive crate is also the hottest.',
    evidence: [
      { label: 'Build share', value: '14.2s / 52.8s', source: 'cargo build --timings' },
      { label: 'Downstream crates', value: '18', source: 'cargo metadata graph' },
      { label: 'Changes (90d)', value: '41 commits', source: 'git log' },
      { label: 'Rebuild amplification', value: '×18 on every touch', source: 'ferrix graph diff' },
    ],
    affected: ['atlas-store', 'atlas-query', 'atlas-ingest', '+9 more'],
    impact: 'Median incremental build triples whenever atlas-store is touched',
    impactSeconds: 9.6,
    recommendation:
      'Split atlas-store into atlas-store-core (SST + block abstractions) and atlas-store-lsm (volatile engine internals); downstream crates depend on the stable core.',
    remediationKind: 'architecture',
    verificationPath: 'Experiment: baseline 52.8s median of 5 → candidate with core split → blast radius 18 → ≤7.',
    confidenceClass: 'high',
    confidence: 86,
    detection: 'critical-path analysis over cargo build --timings + git history',
    measurementStatus: 'estimated',
    experimentEligible: true,
  },
  {
    id: 'ATL-BLD-002',
    section: 'Build',
    severity: 'warning',
    title: 'Linking + codegen takes 24% of the build',
    description:
      '12.6s of the 52.8s build is linking + codegen. The debug info level is 2 across the workspace and split-dwarf is not enabled.',
    evidence: [
      { label: 'Link time', value: '12.6s', source: 'cargo build --timings' },
      { label: 'Debug info', value: 'level 2 · no split-dwarf', source: 'cargo profile config' },
      { label: 'Target dir', value: '3.9 GB', source: 'du -sh target' },
    ],
    affected: ['workspace profile', 'atlas-cli', 'atlas-store'],
    impact: 'Every clean build pays 12.6s of link cost regardless of what changed',
    impactSeconds: 4.8,
    recommendation:
      'Set debug = "line-tables-only" for the dev profile and enable split-debuginfo; re-measure link time after.',
    remediationKind: 'config',
    verificationPath: 'Compare cargo build --timings link segment before/after profile change.',
    confidenceClass: 'high',
    confidence: 91,
    detection: 'profile config scan + timing segment analysis',
    measurementStatus: 'measured',
  },
  {
    id: 'ATL-DEP-003',
    section: 'Dependencies',
    severity: 'warning',
    title: 'two versions of arrow compiled simultaneously',
    description:
      'arrow 53.3.0 (via parquet crate path) and 54.2.0 (via datafusion path) both compile — 5.2s + 4.1s per clean build and duplicated artifacts.',
    evidence: [
      { label: 'Versions', value: '53.3.0 · 54.2.0', source: 'cargo tree -d' },
      { label: 'Wasted', value: '4.1s clean · +38 MB target', source: 'cargo build --timings' },
      { label: 'Dependents', value: 'atlas-ingest · atlas-query', source: 'cargo tree' },
    ],
    affected: ['atlas-ingest', 'atlas-query', 'arrow-*'],
    impact: 'Clean builds pay double compilation for one logical dependency',
    impactSeconds: 4.1,
    recommendation:
      'Unify on arrow 54 via `cargo update arrow@53.3.0 --precise 54.2.0` after fixing the parquet import path.',
    remediationKind: 'command',
    verificationPath: 'cargo tree -d | grep arrow must list a single version set.',
    confidenceClass: 'deterministic',
    confidence: 100,
    detection: 'duplicate version scan over Cargo.lock',
    measurementStatus: 'measured',
  },
  {
    id: 'ATL-DEP-004',
    section: 'Dependencies',
    severity: 'info',
    title: 'feature unification pulls datafusion into atlas-cli',
    description:
      'resolver v1 unifies features across the workspace, so atlas-cli compiles datafusion features it never uses (+2.9s).',
    evidence: [
      { label: 'Resolver', value: 'v1', source: 'Cargo.toml [workspace]' },
      { label: 'Extra cost', value: '+2.9s per clean build', source: 'feature graph diff' },
    ],
    affected: ['atlas-cli', 'datafusion'],
    impact: 'CLI builds compile analytics features they do not use',
    impactSeconds: 2.9,
    recommendation: 'Adopt resolver = "2" in the workspace and enable datafusion features only where needed.',
    remediationKind: 'config',
    verificationPath: 'cargo tree -e features -i atlas-cli | grep datafusion must return empty after resolver v2.',
    confidenceClass: 'high',
    confidence: 88,
    detection: 'feature-unification scan',
    measurementStatus: 'estimated',
  },
  {
    id: 'ATL-WRK-005',
    section: 'Workspace',
    severity: 'warning',
    title: 'atlas-common is a change-amplifier',
    description:
      'atlas-common changed 28 times in 90 days and 18 crates depend on it — every touch re-invalidates 78% of the workspace.',
    evidence: [
      { label: 'Dependents', value: '18 crates', source: 'cargo metadata graph' },
      { label: 'Changes (90d)', value: '28 commits', source: 'git log' },
      { label: 'Fan-out', value: '11 direct', source: 'ferrix graph' },
    ],
    affected: ['atlas-common', '+17 more'],
    impact: 'Highest churn × widest fan-out combination in the workspace',
    impactSeconds: 6.2,
    recommendation:
      'Extract atlas-bytes + atlas-schema (stable) from atlas-common; keep glue code in atlas-common (volatile).',
    remediationKind: 'architecture',
    verificationPath: 'Experiment: blast radius of atlas-common/src/bytes.rs drops 18 → ≤5 crates.',
    confidenceClass: 'high',
    confidence: 84,
    detection: 'change-frequency × fan-out correlation',
    measurementStatus: 'estimated',
    experimentEligible: true,
  },
  {
    id: 'ATL-IDE-006',
    section: 'IDE',
    severity: 'info',
    title: 'rust-analyzer check hangs on atlas-query tests',
    description:
      'flycheck runs cargo check --all-targets, compiling test binaries of atlas-query (9.1s) on every save — blocking diagnostics for 14 developers.',
    evidence: [
      { label: 'Flycheck time', value: 'p50 9.1s', source: 'rust-analyzer stats' },
      { label: 'Developers affected', value: '14', source: 'IDE telemetry' },
    ],
    affected: ['atlas-query', 'rust-analyzer'],
    impact: 'Slow in-IDE feedback loop during query-planner work',
    recommendation: 'Set rust-analyzer check.invocationStrategy = once and exclude atlas-query tests from flycheck.',
    remediationKind: 'config',
    verificationPath: 'rust-analyzer flycheck p50 must drop below 4s.',
    confidenceClass: 'medium',
    confidence: 72,
    detection: 'IDE telemetry sampling',
    measurementStatus: 'measured',
  },
  {
    id: 'ATL-ASY-007',
    section: 'Async',
    severity: 'warning',
    title: 'blocking file IO inside atlas-ingest runtime worker',
    description:
      'atlas-ingest/src/writer.rs:112 calls std::fs::write on the tokio worker thread — p95 stall 210ms under ingest load.',
    evidence: [
      { label: 'Location', value: 'atlas-ingest/src/writer.rs:112', source: 'static analysis' },
      { label: 'Worker stall', value: 'p95 210ms', source: 'tokio-console telemetry' },
    ],
    affected: ['atlas-ingest', 'tokio runtime'],
    impact: 'Ingest latency spikes under load; no build-time claim',
    recommendation: 'Wrap writer IO in tokio::task::spawn_blocking or move to tokio::fs.',
    remediationKind: 'patch',
    verificationPath: 'tokio-console: ingest writer stall p95 must drop below 10ms.',
    confidenceClass: 'deterministic',
    confidence: 100,
    detection: 'async blocking-call static analysis',
    measurementStatus: 'measured',
  },
]

export const DOCTOR_ATLAS: DoctorReport = {
  workspace: WORKSPACE_ATLAS.name,
  profile: WORKSPACE_ATLAS.profile,
  toolchain: WORKSPACE_ATLAS.toolchain,
  buildTime: 52.8,
  estimatedRange: [31, 40],
  confidence: 78,
  criticalPath: [
    { name: 'atlas-store', seconds: 14.2, kind: 'workspace' },
    { name: 'atlas-query', seconds: 9.6, kind: 'workspace' },
    { name: 'proc-macro chain', seconds: 6.8, kind: 'proc-macro' },
    { name: 'tokio', seconds: 4.4, kind: 'external' },
    { name: 'arrow (×2)', seconds: 5.2, kind: 'external' },
    { name: 'linking + codegen', seconds: 12.6, kind: 'linker' },
  ],
  findings: ATLAS_FINDINGS,
  scannedAt: WORKSPACE_ATLAS.lastScan,
  phases: [
    { label: 'Parsing cargo metadata', detail: '23 workspace crates · 96 edges' },
    { label: 'Reading Cargo.lock', detail: '2 duplicate version groups found' },
    { label: 'Ingesting build timings', detail: 'cargo build --timings · dev profile · 52.8s' },
    { label: 'Analyzing git history', detail: '861 commits · 90 days' },
    { label: 'Profiling proc macros', detail: '1 version set · 6 derive crates' },
    { label: 'Checking feature unification', detail: 'resolver v1 · datafusion pulled into atlas-cli' },
    { label: 'Correlating CI telemetry', detail: '18 jobs · 41% cache miss' },
    { label: 'Consulting engineering graph', detail: 'F-EIR snapshot c7d21ef · verified' },
  ],
  summary: { developerBuild: '−27%', ciBuild: '−33%', diskUsage: '−19%' },
  criticalPathExplanation: 'atlas-store blocks 18 crates; the core/lsm split proposal is experiment-ready',
  criticalPathCaption:
    'arrow compiled twice (ATL-DEP-003) · linking includes codegen · dev profile debug level 2',
}

// --------------------------------------------------------------- atlas: graph

const W_A = (over: Partial<GraphNode> & { id: string }): GraphNode => ({
  band: 'lib',
  kind: 'workspace',
  buildTime: 3,
  fanIn: 1,
  fanOut: 2,
  downstream: 1,
  changeFreq: 5,
  ...over,
})

const E_A = (id: string, buildTime: number, over: Partial<GraphNode> = {}): GraphNode => ({
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

export const GRAPH_NODES_ATLAS: GraphNode[] = [
  W_A({ id: 'atlas-cli', band: 'bin', buildTime: 2.1, fanIn: 0, fanOut: 3, downstream: 0, changeFreq: 6 }),
  W_A({ id: 'atlas-server', band: 'bin', buildTime: 3.4, fanIn: 0, fanOut: 4, downstream: 0, changeFreq: 9 }),
  W_A({ id: 'atlas-ingest', buildTime: 5.8, fanIn: 2, fanOut: 3, downstream: 6, changeFreq: 14 }),
  W_A({ id: 'atlas-query', buildTime: 9.6, fanIn: 3, fanOut: 4, downstream: 8, changeFreq: 19, critical: true }),
  W_A({ id: 'atlas-store', buildTime: 14.2, fanIn: 4, fanOut: 6, downstream: 18, changeFreq: 41, critical: true }),
  W_A({ id: 'atlas-common', buildTime: 4.6, fanIn: 11, fanOut: 8, downstream: 18, changeFreq: 28, critical: true }),
  W_A({ id: 'atlas-schema', buildTime: 2.2, fanIn: 9, fanOut: 0, downstream: 12, changeFreq: 3 }),
  W_A({ id: 'atlas-bytes', buildTime: 1.4, fanIn: 7, fanOut: 0, downstream: 9, changeFreq: 2 }),
  W_A({ id: 'atlas-parquet', buildTime: 3.7, fanIn: 2, fanOut: 2, downstream: 4, changeFreq: 7 }),
  W_A({ id: 'atlas-lsm', buildTime: 6.1, fanIn: 2, fanOut: 2, downstream: 5, changeFreq: 22 }),
  W_A({ id: 'atlas-sst', buildTime: 3.2, fanIn: 3, fanOut: 1, downstream: 4, changeFreq: 8 }),
  W_A({ id: 'atlas-compaction', buildTime: 2.9, fanIn: 2, fanOut: 1, downstream: 2, changeFreq: 6 }),
  W_A({ id: 'atlas-planner', buildTime: 4.8, fanIn: 2, fanOut: 2, downstream: 3, changeFreq: 12 }),
  W_A({ id: 'atlas-exec', buildTime: 3.6, fanIn: 2, fanOut: 1, downstream: 2, changeFreq: 9 }),
  W_A({ id: 'atlas-proto', kind: 'proc-macro', buildTime: 1.8, fanIn: 6, fanOut: 0, downstream: 10, changeFreq: 1 }),
  W_A({ id: 'atlas-testkit', band: 'bin', buildTime: 1.9, fanIn: 0, fanOut: 2, downstream: 0, changeFreq: 4 }),
  E_A('tokio', 4.4, { fanIn: 14, downstream: 16 }),
  E_A('arrow', 5.2, { fanIn: 4, downstream: 6, duplicate: true, versions: ['53.3.0', '54.2.0'] }),
  E_A('parquet', 3.9, { fanIn: 3, downstream: 4 }),
  E_A('datafusion', 6.4, { fanIn: 2, downstream: 3 }),
  E_A('serde', 2.1, { fanIn: 18, downstream: 21 }),
  E_A('thiserror', 0.8, { fanIn: 12, downstream: 15 }),
  E_A('prost', 1.6, { fanIn: 4, downstream: 8, kind: 'proc-macro' }),
  E_A('clap', 1.2, { fanIn: 2, downstream: 2 }),
]

export const GRAPH_EDGES_ATLAS: GraphEdge[] = [
  { from: 'atlas-common', to: 'atlas-schema' },
  { from: 'atlas-common', to: 'atlas-bytes' },
  { from: 'atlas-common', to: 'atlas-proto' },
  { from: 'atlas-common', to: 'atlas-lsm' },
  { from: 'atlas-common', to: 'atlas-sst' },
  { from: 'atlas-common', to: 'atlas-planner' },
  { from: 'atlas-common', to: 'atlas-ingest' },
  { from: 'atlas-common', to: 'atlas-query' },
  { from: 'atlas-lsm', to: 'atlas-store' },
  { from: 'atlas-sst', to: 'atlas-lsm' },
  { from: 'atlas-compaction', to: 'atlas-lsm' },
  { from: 'atlas-store', to: 'atlas-query' },
  { from: 'atlas-store', to: 'atlas-server' },
  { from: 'atlas-store', to: 'atlas-ingest' },
  { from: 'atlas-query', to: 'atlas-planner' },
  { from: 'atlas-query', to: 'atlas-exec' },
  { from: 'atlas-query', to: 'atlas-server' },
  { from: 'atlas-planner', to: 'atlas-exec' },
  { from: 'atlas-parquet', to: 'atlas-ingest' },
  { from: 'atlas-parquet', to: 'atlas-query' },
  { from: 'atlas-schema', to: 'atlas-ingest' },
  { from: 'atlas-schema', to: 'atlas-query' },
  { from: 'atlas-schema', to: 'atlas-parquet' },
  { from: 'atlas-bytes', to: 'atlas-sst' },
  { from: 'atlas-bytes', to: 'atlas-lsm' },
  { from: 'atlas-proto', to: 'atlas-server' },
  { from: 'atlas-ingest', to: 'atlas-server' },
  { from: 'atlas-cli', to: 'atlas-query' },
  { from: 'atlas-cli', to: 'atlas-store' },
  { from: 'atlas-testkit', to: 'atlas-lsm' },
  { from: 'atlas-testkit', to: 'atlas-planner' },
  { from: 'tokio', to: 'atlas-store' },
  { from: 'tokio', to: 'atlas-ingest' },
  { from: 'tokio', to: 'atlas-server' },
  { from: 'arrow', to: 'atlas-query' },
  { from: 'arrow', to: 'parquet' },
  { from: 'parquet', to: 'atlas-parquet' },
  { from: 'datafusion', to: 'atlas-query' },
  { from: 'datafusion', to: 'atlas-cli' },
  { from: 'serde', to: 'atlas-common' },
  { from: 'thiserror', to: 'atlas-common' },
  { from: 'prost', to: 'atlas-proto' },
  { from: 'clap', to: 'atlas-cli' },
]

export const DUPLICATES_ATLAS: DuplicateGroup[] = [
  {
    name: 'arrow',
    versions: ['53.3.0', '54.2.0'],
    dependents: ['atlas-ingest', 'atlas-query', 'atlas-parquet'],
    wastedSeconds: 4.1,
  },
  {
    name: 'bytes',
    versions: ['1.8.0', '1.9.0'],
    dependents: ['atlas-common', 'atlas-lsm', 'tokio', 'prost'],
    wastedSeconds: 0.6,
  },
]

export const BLAST_ATLAS: BlastEntry[] = [
  {
    file: 'atlas-common/src/bytes.rs',
    crate: 'atlas-common',
    affectedWorkspace: 18,
    chain: ['atlas-common', 'atlas-lsm', 'atlas-store', 'atlas-query', 'atlas-server'],
    incrementalDelta: 11.8,
    suggestion: 'Extract atlas-bytes (stable) — expect fan-out to drop to ≤5 (ATL-WRK-005).',
  },
  {
    file: 'atlas-store/src/lsm/memtable.rs',
    crate: 'atlas-store',
    affectedWorkspace: 12,
    chain: ['atlas-store', 'atlas-query', 'atlas-server'],
    incrementalDelta: 14.2,
    suggestion: 'The memtable trait is volatile — isolate behind atlas-store-core.',
  },
  {
    file: 'atlas-schema/src/record.rs',
    crate: 'atlas-schema',
    affectedWorkspace: 12,
    chain: ['atlas-schema', 'atlas-common', 'atlas-query', 'atlas-ingest'],
    incrementalDelta: 5.4,
    suggestion: 'Schema derives churn — move procedural macros to atlas-proto and version the record wire format.',
  },
  {
    file: 'atlas-ingest/src/writer.rs',
    crate: 'atlas-ingest',
    affectedWorkspace: 4,
    chain: ['atlas-ingest', 'atlas-server'],
    incrementalDelta: 2.8,
    suggestion: 'Writer internals are self-contained — safe to iterate quickly (also see ATL-ASY-007).',
  },
]

const ATLAS_ADD_DEP_CATALOG: Record<
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
  axum: {
    version: '0.8.1',
    cratesAdded: 9,
    procMacrosAdded: 2,
    targetMB: 8.6,
    cleanDelta: 3.1,
    incrementalDelta: 0.8,
    ciDelta: 12,
    transitiveDeps: 11,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +axum 0.8.1' },
      { label: 'axum-core', note: '+9 crates, +2 proc-macros' },
      { label: 'atlas-server', note: 'shared crate — highest blast radius' },
      { label: '8 downstream crates', note: 'full rebuild triggered' },
    ],
    security: [
      { label: '11 new transitive dependencies', level: 'info' },
      { label: 'axum-macros executes at build time — review build-script permissions', level: 'warn' },
    ],
    suggestions: [
      'Isolate axum behind an atlas-http crate (keeps handlers decoupled)',
      'Enable only tokio-rustls features to shrink the tree',
      'Keep extractor macros behind an optional feature',
    ],
  },
  redb: {
    version: '2.2.0',
    cratesAdded: 4,
    procMacrosAdded: 0,
    targetMB: 3.2,
    cleanDelta: 1.9,
    incrementalDelta: 0.6,
    ciDelta: 7,
    transitiveDeps: 3,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +redb 2.2.0' },
      { label: 'redb', note: '+4 crates, pure rust' },
      { label: 'atlas-store', note: 'engine crate — contained blast radius' },
      { label: '5 downstream crates', note: 'rebuild triggered' },
    ],
    security: [
      { label: '3 new transitive dependencies', level: 'info' },
      { label: 'No build scripts detected', level: 'info' },
    ],
    suggestions: [
      'Contained footprint — safe to adopt for the metadata store',
      'Pin via workspace dependency so the version cannot fork',
    ],
  },
  'tracing-appender': {
    version: '0.2.3',
    cratesAdded: 2,
    procMacrosAdded: 0,
    targetMB: 0.9,
    cleanDelta: 0.4,
    incrementalDelta: 0.1,
    ciDelta: 2,
    transitiveDeps: 2,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +tracing-appender 0.2.3' },
      { label: 'tracing stack', note: 'already compiled — zero marginal crates' },
      { label: 'CI', note: '+2s per clean pipeline' },
    ],
    security: [{ label: '2 new transitive dependencies', level: 'info' }],
    suggestions: ['Cheapest option in this catalog — already inside the tracing ecosystem'],
  },
  datafusion: {
    version: '43.0.0',
    cratesAdded: 38,
    procMacrosAdded: 1,
    targetMB: 61.7,
    cleanDelta: 8.4,
    incrementalDelta: 2.9,
    ciDelta: 44,
    transitiveDeps: 29,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +datafusion 43.0.0' },
      { label: 'arrow + parquet', note: '+29 transitive crates' },
      { label: 'atlas-query', note: 'engine crate — widest fan-out' },
      { label: 'CI', note: '+44s per clean pipeline' },
    ],
    security: [
      { label: '29 new transitive dependencies', level: 'info' },
      { label: 'Heavy artifact footprint: +61.7 MB target size', level: 'warn' },
    ],
    suggestions: [
      'Adopt behind a query-engine trait to keep planners swappable',
      'Disable unneeded languages/features (default-features = false)',
      'Consider a sidecar process instead of an in-process dependency',
    ],
  },
}

const SPLIT_SIM_ATLAS = {
  source: 'atlas-common',
  before: {
    buildSeconds: 24.6,
    fanOut: 8,
    downstream: 18,
    modules: ['bytes', 'schema', 'proto', 'glue'],
  },
  proposal: {
    crates: [
      { name: 'atlas-bytes', downstream: 9, buildSeconds: 3.1, modules: ['bytes'] },
      { name: 'atlas-schema', downstream: 12, buildSeconds: 6.4, modules: ['schema', 'proto'] },
      { name: 'atlas-common', downstream: 4, buildSeconds: 8.9, modules: ['glue'] },
    ],
    buildSeconds: 18.4,
  },
  improvementPct: 25.2,
  migration: [
    'Create atlas-bytes with pure buffer abstractions (no IO)',
    'Re-point atlas-lsm + atlas-sst to atlas-bytes first',
    'Move schema + proto into atlas-schema behind a versioned wire format',
    'Keep glue code in atlas-common (volatile, low fan-out)',
    'Verify: blast radius of atlas-common drops 18 → ≤4 crates',
  ],
}

// ------------------------------------------------------------- atlas: health

export const HEALTH_ATLAS: HealthPayload = {
  workspace: WORKSPACE_ATLAS.name,
  crates: WORKSPACE_ATLAS.crates,
  edges: WORKSPACE_ATLAS.edges,
  toolchain: WORKSPACE_ATLAS.toolchain,
  cacheHitRate: 59,
  kpis: {
    buildPerformance: { delta: -16, label: 'Build performance' },
    ciCost: { delta: -9, label: 'CI cost' },
    dependencyRisk: { delta: -22, label: 'Dependency risk' },
    prRegressions: { count: 1, label: 'PR build regressions' },
    architectureDebt: { count: 9, label: 'Architecture debt' },
    runtimeBottlenecks: { count: 3, label: 'Runtime bottlenecks' },
  },
  buildTrend: [
    { month: 'Apr', clean: 58.9, incremental: 6.1 },
    { month: 'May', clean: 57.2, incremental: 6.4 },
    { month: 'Jun', clean: 56.0, incremental: 7.8 },
    { month: 'Jul', clean: 54.7, incremental: 9.2 },
    { month: 'Aug', clean: 53.5, incremental: 10.6 },
    { month: 'Sep', clean: 52.8, incremental: 12.1 },
  ],
  slowestCrates: [
    { name: 'atlas-store', seconds: 14.2, downstream: 18 },
    { name: 'atlas-query', seconds: 9.6, downstream: 8 },
    { name: 'atlas-lsm', seconds: 6.1, downstream: 5 },
    { name: 'atlas-planner', seconds: 4.8, downstream: 3 },
    { name: 'atlas-common', seconds: 4.6, downstream: 18 },
    { name: 'atlas-ingest', seconds: 5.8, downstream: 6 },
  ],
  activity: [
    {
      id: 'b1',
      time: '1h ago',
      kind: 'duplicate',
      title: 'arrow version fork widened',
      detail: '53.3.0 and 54.2.0 both compile — ATL-DEP-003',
      severity: 'warning',
    },
    {
      id: 'b2',
      time: '5h ago',
      kind: 'amplification',
      title: 'atlas-common touch → 18-crate rebuild',
      detail: 'PR #97 — 78% of workspace re-invalidated',
      severity: 'warning',
    },
    {
      id: 'b3',
      time: '1d ago',
      kind: 'experiment',
      title: 'EXP-031 draft created',
      detail: 'link-profile slimming (ATL-BLD-002) — awaiting baseline',
      severity: 'info',
    },
    {
      id: 'b4',
      time: '2d ago',
      kind: 'regression',
      title: 'CI pipeline wall-clock +7%',
      detail: 'datafusion feature pull-in (ATL-DEP-004)',
      severity: 'critical',
    },
    {
      id: 'b5',
      time: '3d ago',
      kind: 'improvement',
      title: 'atlas-lsm build time −9%',
      detail: 'memtable trait split landed — measured 6.7 → 6.1s',
      severity: 'info',
    },
    {
      id: 'b6',
      time: '4d ago',
      kind: 'config',
      title: 'resolver v2 migration proposed',
      detail: 'blocks ATL-DEP-004 — scheduled next sprint',
      severity: 'info',
    },
  ],
  findingCounts: [
    { section: 'Build', count: 2 },
    { section: 'Dependencies', count: 2 },
    { section: 'Workspace', count: 1 },
    { section: 'IDE', count: 1 },
    { section: 'Async', count: 1 },
  ],
  lastScan: WORKSPACE_ATLAS.lastScan,
  insight: {
    text: 'Incremental builds doubled since the async-runtime migration — 6.1s → 12.1s in six months.',
    question: 'Why did incremental builds regress while clean builds improved?',
  },
}

// ----------------------------------------------------------------- selectors

export function getWorkspaces(): WorkspacesPayload {
  return { workspaces: WORKSPACES, default: WORKSPACES_DEFAULT }
}

export function getHealth(ws: string): HealthPayload {
  return ws === 'atlas-consortium' ? HEALTH_ATLAS : HEALTH
}

export function getDoctor(ws: string): DoctorReport {
  return ws === 'atlas-consortium' ? DOCTOR_ATLAS : DOCTOR
}

export function getGraphPayload(ws: string): GraphPayload {
  if (ws === 'atlas-consortium') {
    return {
      nodes: GRAPH_NODES_ATLAS,
      edges: GRAPH_EDGES_ATLAS,
      duplicates: DUPLICATES_ATLAS,
      blast: BLAST_ATLAS,
      meta: {
        workspaceCrates: WORKSPACE_ATLAS.crates,
        totalEdges: WORKSPACE_ATLAS.edges,
        lastScan: WORKSPACE_ATLAS.lastScan,
      },
      catalog: {
        addDeps: Object.entries(ATLAS_ADD_DEP_CATALOG).map(([id, v]) => ({ id, version: v.version })),
        splitCandidates: [SPLIT_SIM_ATLAS.source],
      },
    }
  }
  return {
    nodes: GRAPH_NODES,
    edges: GRAPH_EDGES,
    duplicates: DUPLICATES,
    blast: BLAST,
    meta: {
      workspaceCrates: WORKSPACE.crates,
      totalEdges: WORKSPACE.edges,
      lastScan: WORKSPACE.lastScan,
    },
    catalog: {
      addDeps: Object.entries(ADD_DEP_CATALOG).map(([id, v]) => ({ id, version: v.version })),
      splitCandidates: [SPLIT_SIM.source],
    },
  }
}

export function getImpact(
  type: 'add-dep' | 'edit-file' | 'split-crate',
  target: string,
  ws: string,
): AddDepImpact | EditFileImpact | SplitImpact | null {
  const atlas = ws === 'atlas-consortium'
  if (type === 'add-dep') {
    const catalog = atlas ? ATLAS_ADD_DEP_CATALOG : ADD_DEP_CATALOG
    const entry = catalog[target]
    if (!entry) return null
    return { kind: 'add-dep', crate: target, ...entry, measurementStatus: 'estimated' }
  }
  if (type === 'edit-file') {
    const blast = atlas ? BLAST_ATLAS : BLAST
    const entry = blast.find((b) => b.file === target)
    if (!entry) return null
    return {
      kind: 'edit-file',
      file: entry.file,
      crate: entry.crate,
      affectedWorkspace: entry.affectedWorkspace,
      chain: entry.chain,
      incrementalDelta: entry.incrementalDelta,
      ciDelta: Math.round(entry.incrementalDelta * 1.6 * 10) / 10,
      notes: [
        `Blast radius: ${entry.affectedWorkspace} workspace crates re-invalidate`,
        `Chain: ${entry.chain.join(' → ')}`,
        'Estimates derived from build telemetry × graph traversal',
      ],
      suggestion: entry.suggestion,
      measurementStatus: 'estimated',
    }
  }
  if (type === 'split-crate') {
    const sim = atlas ? SPLIT_SIM_ATLAS : SPLIT_SIM
    return {
      kind: 'split-crate',
      source: sim.source,
      before: sim.before,
      proposal: sim.proposal,
      improvementPct: sim.improvementPct,
      migration: sim.migration,
      measurementStatus: 'estimated',
    }
  }
  return null
}

export function getExperiments(ws: string): ExperimentsPayload {
  // experiments are workspace-scoped: only helios-platform has recorded runs
  return { workspace: ws, experiments: ws === 'atlas-consortium' ? [] : EXPERIMENTS }
}
