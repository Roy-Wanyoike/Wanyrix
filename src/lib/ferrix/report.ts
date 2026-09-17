import type {
  DoctorReport,
  ExperimentsPayload,
  GatesPayload,
  GraphPayload,
  HealthPayload,
  PRAnalysis,
  StoragePayload,
} from './types'
import { GATES, getDoctor, getExperiments, getGraphPayload, getHealth, getPRAnalysis } from './data'
import { storagePayload } from './storage-state'

/**
 * Workspace report generator (round 9) — assembles a full Markdown
 * "ferrix doctor report" from the SAME server-side getters the API routes
 * serve. No client round-trips, no duplicated data paths.
 *
 * Honesty contract (Gate 11 / Gate 21): every number carries its measurement
 * status, estimates are labeled, and the footer states what a real engine
 * would measure vs. what this demo simulates.
 */

function pad(label: string): string {
  return label.padEnd(34, ' ')
}

function severityRank(s: string): number {
  switch (s) {
    case 'critical':
      return 0
    case 'high':
      return 1
    case 'medium':
      return 2
    case 'low':
      return 3
    default:
      return 4
  }
}

export interface ReportBundle {
  filename: string
  markdown: string
  bytes: number
}

export function buildWorkspaceReport(ws: string, now = new Date()): ReportBundle {
  const health: HealthPayload = getHealth(ws)
  const doctor: DoctorReport = getDoctor(ws)
  const graph: GraphPayload = getGraphPayload(ws)
  const pr: PRAnalysis = getPRAnalysis(ws)
  const experiments: ExperimentsPayload = getExperiments(ws)
  const gates: GatesPayload = GATES
  const storage: StoragePayload = storagePayload(now.getTime())

  const L: string[] = []
  const push = (s = '') => L.push(s)

  // ------------------------------------------------------------ header
  push(`# Ferrix workspace report — ${ws}`)
  push()
  push(
    `> Generated ${now.toISOString()} · ferrix web demo v0.4.2 · findings carry stable IDs + evidence (Gate 11) · estimates are labeled, never silently mixed with measured values (Gate 21)`,
  )
  push()

  // ------------------------------------------------------------ summary
  push('## Workspace summary')
  push()
  push('| Field | Value |')
  push('| --- | --- |')
  push(`| Workspace | \`${health.workspace}\` |`)
  push(`| Crates | ${health.crates} |`)
  push(`| Graph edges | ${health.edges} |`)
  push(`| Toolchain | ${health.toolchain} |`)
  push(`| Cache hit rate | ${health.cacheHitRate}% |`)
  push(`| Last scan | ${health.lastScan} |`)
  if (health.insight) {
    push(`| Headline insight | ${health.insight.text} |`)
  }
  push()

  // ------------------------------------------------------------ doctor
  push('## Build intelligence — ferrix doctor')
  push()
  push(
    `- Profile: \`${doctor.profile}\` · Toolchain: \`${doctor.toolchain}\``,
  )
  push(
    `- Build time: **${doctor.buildTime.toFixed(1)}s** (estimated range ${doctor.estimatedRange[0].toFixed(1)}–${doctor.estimatedRange[1].toFixed(1)}s · confidence ${doctor.confidence}%)`,
  )
  push(`- Scanned at: ${doctor.scannedAt}`)
  if (doctor.summary) {
    push(`- Developer build: ${doctor.summary.developerBuild} · CI build: ${doctor.summary.ciBuild} · Disk: ${doctor.summary.diskUsage}`)
  }
  if (doctor.criticalPathExplanation) push(`- ${doctor.criticalPathExplanation}`)
  push()
  push('### Critical path')
  push()
  push('| Segment | Seconds | Kind |')
  push('| --- | ---: | --- |')
  for (const seg of doctor.criticalPath) {
    push(`| ${seg.name} | ${seg.seconds.toFixed(1)} | ${seg.kind} |`)
  }
  push()

  push('### Findings (sorted by severity)')
  push()
  const findings = [...doctor.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
  for (const f of findings) {
    push(`#### ${f.id} — ${f.title}`)
    push()
    push(
      `\`${f.severity}\` · \`${f.section}\` · confidence ${f.confidence}% (${f.confidenceClass}) · measurement: **${f.measurementStatus}**` +
        (f.impactSeconds != null ? ` · impact ≈ ${f.impactSeconds.toFixed(1)}s` : ''),
    )
    push()
    push(f.description)
    push()
    if (f.evidence.length > 0) {
      push('**Evidence**')
      push()
      for (const e of f.evidence) {
        push(`- ${e.label}: \`${e.value}\` — _source: ${e.source}_`)
      }
      push()
    }
    if (f.affected.length > 0) push(`- Affected: ${f.affected.map((a) => `\`${a}\``).join(', ')}`)
    push(`- Impact: ${f.impact}`)
    push(`- Recommendation: ${f.recommendation}`)
    push(`- Verification path: ${f.verificationPath}`)
    push(`- Detection: ${f.detection}`)
    push(`- Remediation kind: \`${f.remediationKind}\`${f.experimentEligible ? ' · experiment-eligible' : ''}`)
    push()
  }

  // ------------------------------------------------------------ graph
  push('## Dependency graph')
  push()
  push(`Backbone: ${graph.meta.workspaceCrates} crates · ${graph.meta.totalEdges} edges · last scan ${graph.meta.lastScan}`)
  push()
  if (graph.duplicates.length > 0) {
    push('### Duplicate versions (cargo tree -d)')
    push()
    push('| Crate | Versions | Dependents | Wasted |')
    push('| --- | --- | --- | ---: |')
    for (const d of graph.duplicates) {
      push(`| ${d.name} | ${d.versions.join(' · ')} | ${d.dependents.join(', ')} | ${d.wastedSeconds.toFixed(1)}s |`)
    }
    push()
  }
  push('### Top blast radius (incremental cost per touch)')
  push()
  push('| File | Crate | Affected crates | Incremental delta |')
  push('| --- | --- | ---: | ---: |')
  for (const b of [...graph.blast].sort((x, y) => y.affectedWorkspace - x.affectedWorkspace).slice(0, 5)) {
    push(`| \`${b.file}\` | ${b.crate} | ${b.affectedWorkspace} | ${b.incrementalDelta.toFixed(1)}s |`)
  }
  push()

  // ------------------------------------------------------------ PR analysis
  push('## PR regression guard')
  push()
  push(
    `**PR #${pr.number} — ${pr.title}** · state: \`${pr.state ?? 'open'}\` · author: ${pr.author} (${pr.branch} → ${pr.base})`,
  )
  push()
  push(
    `- Build impact: ${pr.before.toFixed(1)}s → ${pr.after.toFixed(1)}s (**${pr.regressionPct >= 0 ? '+' : ''}${pr.regressionPct}%**) across ${pr.affectedCrates} crates`,
  )
  push(`- Confidence: ${pr.confidence}% (${pr.confidenceClass})`)
  push('- Cause chain: ' + pr.causeChain.map((c) => `${c.label}${c.note ? ` (${c.note})` : ''}`).join(' → '))
  push()

  // ------------------------------------------------------------ experiments
  push('## Experiments')
  push()
  if (experiments.experiments.length === 0) {
    push('_No experiments recorded for this workspace yet — estimates here remain `estimated` until one runs._')
    push()
  } else {
    push('| ID | Hypothesis | Status | Improvement | Claim |')
    push('| --- | --- | --- | ---: | --- |')
    for (const e of experiments.experiments) {
      push(
        `| ${e.id} | ${e.title} | ${e.status} | ${e.improvementPct != null ? `${e.improvementPct.toFixed(1)}%` : '—'} | ${e.claim} |`,
      )
    }
    push()
  }

  // ------------------------------------------------------------ gates
  push('## Release scorecard')
  push()
  push(`**Verdict: ${gates.verdict}** — ${gates.rationale}`)
  push()
  push('| # | Gate | Target | Measured | Status | Blocking |')
  push('| --- | --- | --- | --- | --- | --- |')
  for (const g of gates.gates) {
    push(`| ${g.id} | ${g.name} | ${g.target} | ${g.measured} | ${g.status} | ${g.blocking ? 'yes' : 'no'} |`)
  }
  push()

  // ------------------------------------------------------------ storage
  push('## Storage (simulated telemetry)')
  push()
  push('| Row | MB | Status |')
  push('| --- | ---: | --- |')
  for (const r of storage.rows) {
    push(`| ${r.label} | ${r.sizeMB.toFixed(1)} | ${r.reclaimable ? 'reclaimable' : 'permanent'} |`)
  }
  push()
  push(
    `Total **${storage.totalMB.toFixed(1)} MB** · last GC ${storage.lastGc}${storage.sinceGcMin != null ? ` (${storage.sinceGcMin} min ago)` : ''} · retention ${storage.retention} · bound ${storage.bound}`,
  )
  push()

  // ------------------------------------------------------------ footer
  push('---')
  push()
  push('_Honesty notes:_')
  push()
  push(
    '- All figures labeled `estimated` come from build telemetry × graph traversal simulation and are NOT measured results until a ferrix experiment verifies them (Gate 21).',
  )
  push('- Findings carry stable IDs and per-claim evidence with source attribution; nothing in this report was auto-applied to any repository (Gate 19).')
  push('- Storage numbers are simulated in-process state and reset when the demo server restarts.')
  push('- AI (when connected) only adds grounded explanations on top of deterministic analysis; it never edits code silently.')

  const markdown = L.join('\n')
  const filename = `ferrix-report-${ws}-${now.toISOString().slice(0, 10)}.md`
  return { filename, markdown, bytes: new TextEncoder().encode(markdown).length }
}
