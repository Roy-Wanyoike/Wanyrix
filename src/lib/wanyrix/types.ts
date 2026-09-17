/**
 * Wanyrix — Engineering Intelligence types.
 * Aligned with the W-EIR (Wanyrix Engineering Intermediate Representation) model:
 * every quantitative claim carries evidence, a confidence class and a
 * measurement status (measured / estimated / verified). Estimates are never
 * represented as measurements (Gate 21 / Gate 7 of the MVP acceptance spec).
 */

export type Severity = 'critical' | 'warning' | 'info'

/** Confidence calibration — Gate 13. */
export type ConfidenceClass = 'deterministic' | 'high' | 'medium' | 'estimated'

/** Measurement status of a finding's primary quantitative claim — Gate 21. */
export type MeasurementStatus = 'measured' | 'estimated' | 'verified'

export type FindingSection =
  | 'Build'
  | 'Workspace'
  | 'IDE'
  | 'CI'
  | 'Async'
  | 'Dependencies'

export type RemediationKind =
  | 'command'
  | 'config'
  | 'architecture'
  | 'experiment'
  | 'patch'

export interface Evidence {
  label: string
  value: string
  source: string
}

/** A Wanyrix finding (Gate 11 — finding quality). */
export interface Finding {
  id: string
  section: FindingSection
  severity: Severity
  title: string
  description: string
  evidence: Evidence[]
  affected: string[]
  impact: string
  impactSeconds?: number
  recommendation: string
  remediationKind: RemediationKind
  verificationPath: string
  confidenceClass: ConfidenceClass
  confidence: number
  detection: string
  measurementStatus: MeasurementStatus
  /** true when the finding is a good candidate for a wanyrix experiment */
  experimentEligible?: boolean
}

export interface CriticalPathSegment {
  name: string
  seconds: number
  kind: 'workspace' | 'external' | 'proc-macro' | 'linker'
}

/** GET /api/wanyrix/doctor */
export interface DoctorReport {
  workspace: string
  profile: string
  toolchain: string
  buildTime: number
  estimatedRange: [number, number]
  confidence: number
  criticalPath: CriticalPathSegment[]
  findings: Finding[]
  scannedAt: string
  phases: { label: string; detail: string }[]
  summary: { developerBuild: string; ciBuild: string; diskUsage: string }
  /** workspace-specific explanation for the summary card (payload-driven copy) */
  criticalPathExplanation?: string
  /** footnote under the critical-path chart */
  criticalPathCaption?: string
}

// ---------------------------------------------------------------------------
// Engineering graph
// ---------------------------------------------------------------------------

export type GraphBand = 'bin' | 'lib' | 'external'

export interface GraphNode {
  id: string
  band: GraphBand
  kind: 'workspace' | 'external' | 'proc-macro'
  buildTime: number
  fanIn: number
  fanOut: number
  downstream: number
  changeFreq: number
  versions?: string[]
  duplicate?: boolean
  critical?: boolean
}

export interface GraphEdge {
  from: string
  to: string
}

export interface DuplicateGroup {
  name: string
  versions: string[]
  dependents: string[]
  wastedSeconds: number
}

export interface BlastEntry {
  file: string
  crate: string
  affectedWorkspace: number
  chain: string[]
  incrementalDelta: number
  suggestion: string
}

/** Simulator catalogs — served per workspace so the UI never hardcodes crates. */
export interface ImpactCatalog {
  addDeps: { id: string; version: string }[]
  splitCandidates: string[]
  /** version-upgrade scenarios (round 9) — id = crate name, from/to are semver */
  upgrades: { id: string; from: string; to: string }[]
}

/** GET /api/wanyrix/graph */
/**
 * Cross-view resolution intelligence (round 10): when a duplicate-version
 * group has a matching upgrade scenario, the graph carries the resolution so
 * the duplicates panel can deep-link into the Impact Simulator.
 * `full` = the upgrade unifies the tree; `partial` = one lineage moves but a
 * pin elsewhere keeps the duplicate alive (stated honestly, never glossed).
 */
export interface DuplicateResolution {
  /** upgrade scenario id (= crate name in the simulator catalog) */
  scenarioId: string
  from: string
  to: string
  /** simulated CI delta of the upgrade — negative is a win */
  ciDelta: number
  kind: 'full' | 'partial'
  note: string
}

export interface GraphPayload {
  nodes: GraphNode[]
  edges: GraphEdge[]
  duplicates: DuplicateGroup[]
  blast: BlastEntry[]
  meta: { workspaceCrates: number; totalEdges: number; lastScan: string }
  /** optional per-workspace simulator catalogs (issue #34) */
  catalog?: ImpactCatalog
  /** crate name → upgrade scenario that resolves (fully or partially) the duplicate (round 10) */
  resolutions?: Record<string, DuplicateResolution>
}

// ---------------------------------------------------------------------------
// Impact simulation
// ---------------------------------------------------------------------------

export interface AddDepImpact {
  kind: 'add-dep'
  crate: string
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
  measurementStatus: MeasurementStatus
}

export interface EditFileImpact {
  kind: 'edit-file'
  file: string
  crate: string
  affectedWorkspace: number
  chain: string[]
  incrementalDelta: number
  ciDelta: number
  notes: string[]
  suggestion: string
  measurementStatus: MeasurementStatus
}

export interface SplitImpact {
  kind: 'split-crate'
  source: string
  before: {
    buildSeconds: number
    fanOut: number
    downstream: number
    modules: string[]
  }
  proposal: {
    crates: {
      name: string
      downstream: number
      buildSeconds: number
      modules: string[]
    }[]
    buildSeconds: number
  }
  improvementPct: number
  migration: string[]
  measurementStatus: MeasurementStatus
}

export interface UpgradeImpact {
  kind: 'upgrade-dep'
  crate: string
  from: string
  to: string
  semver: 'major' | 'minor' | 'patch'
  /** true when this upgrade collapses an in-tree duplicate version (de-dup win) */
  duplicateBefore: boolean
  /** crates recompiled by the version bump */
  recompileCrates: number
  /** negative values mean the build gets FASTER (de-dup / perf fix) */
  cleanDelta: number
  incrementalDelta: number
  ciDelta: number
  breaking: { title: string; detail: string }[]
  /** copy-paste migration snippets with honest framing (no fabricated diffs) */
  migrations: { code: string; note: string }[]
  notes: string[]
  suggestions: string[]
  measurementStatus: MeasurementStatus
}

export type ImpactPayload = AddDepImpact | EditFileImpact | SplitImpact | UpgradeImpact

// ---------------------------------------------------------------------------
// Diagnostics (borrow checker + async flow)
// ---------------------------------------------------------------------------

export interface BorrowStep {
  id: number
  line: number
  title: string
  detail: string
  lifetime: { label: string; start: number; end: number; kind: 'shared' | 'mutable' | 'conflict' }
}

export interface BorrowSolution {
  title: string
  code: string
  tradeOff: string
}

export interface BorrowScenario {
  error: string
  code: string[]
  narrative: string
  steps: BorrowStep[]
  timelineTicks: string[]
  solutions: BorrowSolution[]
}

export interface AsyncSegment {
  id: string
  label: string
  startMs: number
  durationMs: number
  kind: 'compute' | 'db' | 'network' | 'background' | 'blocked'
  span: string
  note?: string
  /** overlaps another segment's window — rendered with a concurrency cue */
  concurrent?: boolean
}

export interface AsyncTask {
  id: string
  label: string
  parent?: string
  state: 'running' | 'awaited' | 'resumed' | 'done' | 'blocked'
  detail: string
  /** doctor finding this task relates to (deep link target) */
  findingId?: string
}

/** GET /api/wanyrix/diagnostics */
export interface DiagnosticsPayload {
  borrow: BorrowScenario
  request: {
    id: string
    method: string
    path: string
    totalMs: number
    segments: AsyncSegment[]
    tasks: AsyncTask[]
    warnings: string[]
  }
}

// ---------------------------------------------------------------------------
// PR regression analysis
// ---------------------------------------------------------------------------

export interface PRCheck {
  name: string
  status: 'pass' | 'fail' | 'running'
  duration: string
}

export interface PRAnalysis {
  number: number
  title: string
  author: string
  branch: string
  base: string
  /** PR lifecycle — open while the regression guard blocks it, merged once landed */
  state?: 'open' | 'merged'
  before: number
  after: number
  regressionPct: number
  affectedCrates: number
  confidence: number
  confidenceClass: ConfidenceClass
  causeChain: { label: string; note?: string; kind: 'dep' | 'proc-macro' | 'crate' | 'fanout' }[]
  comment: string
  suggestions: { title: string; detail: string; estimatedSaving: string }[]
  checks: PRCheck[]
  files: { name: string; additions: number; deletions: number }[]
}

// ---------------------------------------------------------------------------
// Experiments (Gate 20 — experiment engine)
// ---------------------------------------------------------------------------

export interface Experiment {
  id: string
  title: string
  findingId: string
  commit: string
  status: 'verified' | 'running' | 'draft'
  claim: MeasurementStatus
  baseline: { seconds: number; runs: number; measuredAt: string } | null
  candidate: { seconds: number; runs: number; measuredAt: string } | null
  improvementPct: number | null
  tests: { passed: number; failed: number } | null
  environment: { toolchain: string; os: string; profile: string; cache: string }
  commands: string[]
  stages: { name: string; state: 'done' | 'active' | 'pending' | 'failed' }[]
  conclusion?: string
}

/** GET /api/wanyrix/experiments */
export interface ExperimentsPayload {
  workspace: string
  experiments: Experiment[]
}

// ---------------------------------------------------------------------------
// Release scorecard (Gates 1..20 consolidated)
// ---------------------------------------------------------------------------

export type GateStatus = 'pass' | 'conditional' | 'fail' | 'pending'

export interface Gate {
  id: number
  name: string
  objective: string
  target: string
  measured: string
  status: GateStatus
  evidence: string
  blocking: boolean
}

export interface BlockingCondition {
  condition: string
  clear: boolean
  note: string
}

/** GET /api/wanyrix/gates */
export interface GatesPayload {
  verdict: 'GO' | 'CONDITIONAL GO' | 'NO-GO'
  rationale: string
  gates: Gate[]
  blockingConditions: BlockingCondition[]
}

// ---------------------------------------------------------------------------
// Issues → PRs traceability
// ---------------------------------------------------------------------------

export interface IssueCheck {
  name: string
  status: 'pass' | 'fail' | 'running'
}

export interface IssueItem {
  id: string
  ghIssue: number
  title: string
  gate: string
  labels: string[]
  state: 'open' | 'in-review' | 'merged' | 'verified'
  pr: {
    number: number
    branch: string
    title: string
    checks: IssueCheck[]
    additions: number
    deletions: number
  } | null
  verification?: string
  repoUrl: string
}

/** GET /api/wanyrix/issues */
export interface IssuesPayload {
  issues: IssueItem[]
}

// ---------------------------------------------------------------------------
// Local storage report (Gate 71.10 — bounded, inspectable disk usage)
// ---------------------------------------------------------------------------

export interface StorageRow {
  label: string
  sizeMB: number
  note: string
  reclaimable: boolean
}

/** GET /api/wanyrix/storage */
export interface StoragePayload {
  rows: StorageRow[]
  totalMB: number
  lastGc: string
  retention: string
  bound: string
  /** cumulative MB reclaimed across all GC runs (server-tracked, simulated) */
  reclaimedTotalMB?: number
  /** minutes elapsed since the last GC — drives the regrowth note */
  sinceGcMin?: number
}

// ---------------------------------------------------------------------------
// Overview / health
// ---------------------------------------------------------------------------

export interface ActivityEvent {
  id: string
  time: string
  kind: 'regression' | 'duplicate' | 'amplification' | 'improvement' | 'config' | 'experiment'
  title: string
  detail: string
  severity: Severity
}

/** GET /api/wanyrix/health */
export interface HealthPayload {
  workspace: string
  crates: number
  edges: number
  toolchain: string
  cacheHitRate: number
  kpis: {
    buildPerformance: { delta: number; label: string }
    ciCost: { delta: number; label: string }
    dependencyRisk: { delta: number; label: string }
    prRegressions: { count: number; label: string }
    architectureDebt: { count: number; label: string }
    runtimeBottlenecks: { count: number; label: string }
  }
  buildTrend: { month: string; clean: number; incremental: number }[]
  slowestCrates: { name: string; seconds: number; downstream: number }[]
  activity: ActivityEvent[]
  findingCounts: { section: FindingSection; count: number }[]
  lastScan: string
  /** workspace-specific headline insight for the overview strip */
  insight?: { text: string; question: string }
}

// ---------------------------------------------------------------------------
// Workspace registry (live workspace switcher)
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
  id: string
  name: string
  description: string
  crates: number
  edges: number
  toolchain: string
  /** css color for the workspace accent dot (bg-<x> token family) */
  accent: 'primary' | 'emerald' | 'zinc'
  /** live = doctor+health indexed and fresh; archived = selectable for history only */
  status: 'live' | 'archived'
  findings: number
  lastScan: string
}

/** GET /api/wanyrix/workspaces */
export interface WorkspacesPayload {
  workspaces: WorkspaceSummary[]
  default: string
}

/** POST /api/wanyrix/explain */
export interface ExplainRequest {
  context: string
  question: string
  kind?: 'issue' | 'borrow' | 'impact' | 'general' | 'gate'
}

export interface ExplainResponse {
  ok: boolean
  explanation?: string
  fallback?: string
  grounded?: boolean
  error?: string
}

export type ViewId =
  | 'overview'
  | 'doctor'
  | 'graph'
  | 'diagnostics'
  | 'prs'
  | 'simulator'
  | 'experiments'
  | 'scorecard'
  | 'issues'
