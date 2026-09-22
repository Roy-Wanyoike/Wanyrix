/**
 * Registered-workspace payload adapters (QA-5-B-1).
 *
 * The fixture routes (/doctor, /graph, /health) used to 404 registered local
 * projects — the ONLY workspace-scoped surfaces that served them were the
 * engine-exec routes — so selecting a connected project dead-ended every
 * fixture-backed view. These routes now spawn the REAL engine against the
 * registered path (server side, see ./registered-scan) and adapt the
 * engine's `wanyrix.doctor/v1` / `wanyrix.graph/v1` envelopes into the web
 * payload shapes with a documented, honesty-preserving mapping:
 *
 *   - findings adapt VERBATIM (the engine's finding shape is the same
 *     Gate-11 shape the web `Finding` type describes — id/section/severity/
 *     evidence/impact/recommendation/verificationPath/confidence/…);
 *   - telemetry the engine v1 does NOT measure (build times, cache rates,
 *     change frequency, VCS churn) becomes honest zeros / empty arrays, and
 *     the payload says so (`buildTelemetry: 'not-measured'`,
 *     `provenance: 'registered-local-project'`, meta.note) — the doctor view
 *     renders a "not measured" notice instead of presenting zeros as data;
 *   - nothing is invented: no blast table, no duplicates, no build trend,
 *     no activity feed for registered projects (those are fixture-telemetry
 *     surfaces; empty means absent, Gate 21).
 *
 * Pure functions over parsed engine JSON — unit-tested with engine-shaped
 * envelopes in tests/unit/registered-workspaces.test.ts (no db, no spawn).
 */

import type {
  DoctorReport,
  Finding,
  FindingSection,
  GraphEdge,
  GraphNode,
  GraphPayload,
  HealthPayload,
} from './types'

/** Subset of the engine's `wanyrix.doctor/v1` envelope the adapter reads. */
export interface EngineDoctorEnvelope {
  schema?: unknown
  workspace?: unknown
  profile?: unknown
  toolchain?: unknown
  generatedAt?: unknown
  findings?: unknown
  summary?: unknown
  [k: string]: unknown
}

/** Subset of the engine's `wanyrix.graph/v1` envelope the adapter reads. */
export interface EngineGraphEnvelope {
  schema?: unknown
  workspace?: unknown
  generatedAt?: unknown
  nodes?: unknown
  edges?: unknown
  meta?: {
    workspaceCrates?: unknown
    totalEdges?: unknown
    lastScan?: unknown
    scope?: unknown
    servedNodes?: unknown
    servedEdges?: unknown
    note?: unknown
    [k: string]: unknown
  }
  [k: string]: unknown
}

/** Keeps only graph-node-shaped rows (id/band/kind present). */
function isNodeArray(v: unknown): v is GraphNode[] {
  return Array.isArray(v) && v.every(isNode)
}

/** Keeps only graph-edge-shaped rows (from/to present). */
function isEdgeArray(v: unknown): v is GraphEdge[] {
  return Array.isArray(v) && v.every(isEdge)
}

const NOT_MEASURED =
  'not measured — the engine v1 doctor is filesystem-static analysis; it emits findings, not build-time telemetry (Gate 21: absent telemetry is labeled, never estimated in disguise)'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isNode = (v: unknown): v is GraphNode =>
  isRecord(v) && typeof v.id === 'string' && typeof v.band === 'string' && typeof v.kind === 'string'

const isEdge = (v: unknown): v is GraphEdge => isRecord(v) && typeof v.from === 'string' && typeof v.to === 'string'

/** Keeps only finding-shaped rows (id present) — anything else is dropped, never guessed. */
function findingsOf(v: unknown): Finding[] {
  if (!Array.isArray(v)) return []
  return v.filter((f): f is Finding => isRecord(f) && typeof f.id === 'string')
}

/**
 * Adapts a REAL engine doctor envelope (from `wanyrix doctor --path … --json`,
 * already validated as `wanyrix.doctor/v1`) into the web DoctorReport.
 * Findings pass through verbatim; build telemetry is an honest not-measured.
 */
export function doctorReportFromEngine(report: EngineDoctorEnvelope): DoctorReport {
  const findings = findingsOf(report.findings)
  const scannedAt = typeof report.generatedAt === 'string' ? report.generatedAt : new Date().toISOString()
  return {
    workspace: typeof report.workspace === 'string' ? report.workspace : 'registered workspace',
    profile: typeof report.profile === 'string' ? report.profile : 'registered-local',
    toolchain: typeof report.toolchain === 'string' ? report.toolchain : 'unknown',
    // engine v1 measures NO build telemetry — zeros are placeholders the
    // doctor view labels via `buildTelemetry: 'not-measured'`, never data
    buildTime: 0,
    estimatedRange: [0, 0],
    confidence: 0,
    criticalPath: [],
    phases: [],
    scannedAt,
    findings,
    summary: {
      developerBuild: NOT_MEASURED,
      ciBuild: NOT_MEASURED,
      diskUsage: 'not measured',
    },
    buildTelemetry: 'not-measured',
    criticalPathExplanation:
      'No critical path is projected for registered local projects — the engine v1 measures findings from the parsed manifests, not per-crate build times (nothing is simulated).',
    criticalPathCaption: 'Build-time telemetry is not measured for this workspace (see the notice above).',
  }
}

/**
 * Adapts a REAL engine graph envelope (`wanyrix graph --path … --json`,
 * validated as `wanyrix.graph/v1`) into the web GraphPayload. The engine
 * already derives fanIn/fanOut/downstream from its served edge list
 * (aggregateSource: served-edges — the same ENG-TCA-3 invariant the
 * fixtures uphold), and its meta note explains the zero telemetry.
 */
export function graphPayloadFromEngine(report: EngineGraphEnvelope): GraphPayload {
  const nodes = isNodeArray(report.nodes) ? report.nodes : []
  const edges = isEdgeArray(report.edges) ? report.edges : []
  const meta = report.meta ?? {}
  const totalEdges = typeof meta.totalEdges === 'number' ? meta.totalEdges : edges.length
  return {
    nodes,
    edges,
    // the engine v1 detects no duplicate-version groups and emits no blast
    // sample — honest empty states, never fixture data under a real name
    duplicates: [],
    blast: [],
    meta: {
      workspaceCrates: typeof meta.workspaceCrates === 'number' ? meta.workspaceCrates : nodes.filter((n) => n.kind === 'workspace').length,
      totalEdges,
      lastScan: typeof meta.lastScan === 'string' ? meta.lastScan : (typeof report.generatedAt === 'string' ? report.generatedAt : new Date().toISOString()),
      scope: 'full-manifest-graph',
      servedNodes: nodes.length,
      servedEdges: edges.length,
      aggregateSource: 'served-edges',
      note:
        typeof meta.note === 'string'
          ? meta.note
          : 'Every node is a measured crate from the scanned manifests; per-node aggregates derive from the served edge list. buildTime/changeFreq are 0 = not-measured.',
      provenance: 'registered-local-project',
    },
  }
}

/**
 * Builds the Overview payload for a registered local project from TWO real
 * engine spawns (doctor + graph): measured totals (crates/edges/toolchain),
 * real per-section finding counts, and honest empties for the telemetry
 * surfaces the engine does not measure (build trend, cache rate, activity).
 */
export function healthPayloadFromEngine(doctor: DoctorReport, graph: GraphPayload): HealthPayload {
  // per-section finding counts are MEASURED (counted over the engine's own
  // findings); the web FindingSection vocabulary is a subset the engine shares
  const counts = new Map<FindingSection, number>()
  for (const f of doctor.findings) {
    const section = f.section as FindingSection
    counts.set(section, (counts.get(section) ?? 0) + 1)
  }
  const zeroKpi = { delta: 0, label: '' }
  return {
    workspace: doctor.workspace,
    crates: graph.meta.workspaceCrates,
    edges: graph.meta.totalEdges,
    toolchain: doctor.toolchain,
    // cache telemetry does not exist for registered projects — 0 with the
    // payload-level `provenance` marker (rendered as "not measured")
    cacheHitRate: 0,
    kpis: {
      buildPerformance: { ...zeroKpi, label: 'Build performance' },
      ciCost: { ...zeroKpi, label: 'CI cost' },
      dependencyRisk: { ...zeroKpi, label: 'Dependency risk' },
      prRegressions: { count: 0, label: 'PR build regressions' },
      architectureDebt: { count: 0, label: 'Architecture debt' },
      runtimeBottlenecks: { count: 0, label: 'Runtime bottlenecks' },
    },
    buildTrend: [],
    slowestCrates: [],
    activity: [],
    findingCounts: [...counts.entries()].map(([section, count]) => ({ section, count })),
    lastScan: graph.meta.lastScan,
    provenance: 'registered-local-project',
    insight: {
      text: 'Registered local project — findings and crate/edge counts below are REAL engine measurements; build-time telemetry is not measured (zeros are placeholders).',
      question: 'Connect more projects from the topbar to compare them against the demo workspaces.',
    },
  }
}
