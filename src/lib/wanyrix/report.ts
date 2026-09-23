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
 * "wanyrix doctor report" from the SAME server-side getters the API routes
 * serve. No client round-trips, no duplicated data paths.
 *
 * Honesty contract (Gate 11 / Gate 21): every number carries its measurement
 * status, estimates are labeled, and the footer states what a real engine
 * would measure vs. what this demo simulates.
 */

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
  /** envelope schema marker so machine consumers can pin the markdown format (ENG-TCA-6d) */
  schema: 'wanyrix.markdown/v1'
  filename: string
  markdown: string
  bytes: number
}

/* ------------------------------------------------------------------ json -- */

/**
 * JSON report flavor (round 10) — the CLI contract says every wanyrix command
 * speaks `--json`; the web report surface now does too. Same server getters,
 * same sections as the Markdown flavor, but machine-readable: stable schema
 * version, per-finding evidence arrays, measurement statuses, and the honesty
 * notes as data instead of prose.
 */
export interface WorkspaceJsonReport {
  schema: 'wanyrix.report/v1'
  workspace: string
  generatedAt: string
  summary: {
    crates: number
    edges: number
    toolchain: string
    cacheHitRate: number
    lastScan: string
    headlineInsight?: string
  }
  doctor: {
    profile: string
    /** current dev-profile build time (build telemetry), in seconds */
    buildTimeSeconds: number
    /** structured form of the current build time (ENG-TCA-5) */
    buildTime: { value: number; unit: 'seconds' }
    /**
     * ESTIMATED build time AFTER applying the top-priority fix — a projection
     * with explicit semantics, NOT a confidence interval around
     * buildTimeSeconds (buildTime may legitimately fall outside the range).
     * Replaces the ambiguous flat `estimatedRangeSeconds` tuple (ENG-TCA-5).
     */
    estimatedAfterFix: {
      unit: 'seconds'
      estimatedRange: { low: number; high: number }
      status: 'estimated'
      meaning: 'projected-after-top-fix'
      confidencePct: number
      note: string
    }
    confidencePct: number
    scannedAt: string
    criticalPath: { name: string; seconds: number; kind: string }[]
    findings: {
      id: string
      title: string
      severity: string
      section: string
      confidencePct: number
      confidenceClass: string
      measurementStatus: string
      impactSeconds: number | null
      description: string
      evidence: { label: string; value: string; source: string }[]
      affected: string[]
      recommendation: string
      verificationPath: string
      remediationKind: string
      experimentEligible: boolean
    }[]
  }
  graph: {
    duplicates: { name: string; versions: string[]; dependents: string[]; wastedSeconds: number }[]
    blastTop: { file: string; crate: string; affectedWorkspace: number; incrementalDelta: number }[]
  }
  pr: {
    number: number
    title: string
    state: string
    regressionPct: number
    affectedCrates: number
    confidencePct: number
    confidenceClass: string
  }
  experiments: {
    id: string
    title: string
    status: string
    improvementPct: number | null
    claim: string
  }[]
  gates: {
    verdict: string
    rationale: string
    gates: { id: number; name: string; target: string; measured: string; status: string; blocking: boolean }[]
  }
  storage: {
    rows: { label: string; sizeMB: number; reclaimable: boolean }[]
    totalMB: number
    lastGc: string
    retention: string
    bound: string
    note: string
  }
  honestyNotes: string[]
}

export interface ReportJsonBundle {
  filename: string
  json: WorkspaceJsonReport
  bytes: number
}

export function buildWorkspaceJsonReport(ws: string, now = new Date()): ReportJsonBundle {
  const health: HealthPayload = getHealth(ws)
  const doctor: DoctorReport = getDoctor(ws)
  const graph: GraphPayload = getGraphPayload(ws)
  const pr: PRAnalysis = getPRAnalysis(ws)
  const experiments: ExperimentsPayload = getExperiments(ws)
  const storage: StoragePayload = storagePayload(now.getTime())

  const payload: WorkspaceJsonReport = {
    schema: 'wanyrix.report/v1',
    workspace: ws,
    generatedAt: now.toISOString(),
    summary: {
      crates: health.crates,
      edges: health.edges,
      toolchain: health.toolchain,
      cacheHitRate: health.cacheHitRate,
      lastScan: health.lastScan,
      headlineInsight: health.insight?.text,
    },
    doctor: {
      profile: doctor.profile,
      buildTimeSeconds: doctor.buildTime,
      buildTime: { value: doctor.buildTime, unit: 'seconds' },
      estimatedAfterFix: {
        unit: 'seconds',
        estimatedRange: { low: doctor.estimatedRange[0], high: doctor.estimatedRange[1] },
        status: 'estimated',
        meaning: 'projected-after-top-fix',
        confidencePct: doctor.confidence,
        note: 'Estimated build time AFTER applying the top-priority fix — a projection, not a confidence interval; buildTimeSeconds may legitimately fall outside this range.',
      },
      confidencePct: doctor.confidence,
      scannedAt: doctor.scannedAt,
      criticalPath: doctor.criticalPath.map((s) => ({ name: s.name, seconds: s.seconds, kind: s.kind })),
      findings: [...doctor.findings]
        .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
        .map((f) => ({
          id: f.id,
          title: f.title,
          severity: f.severity,
          section: f.section,
          confidencePct: f.confidence,
          confidenceClass: f.confidenceClass,
          measurementStatus: f.measurementStatus,
          impactSeconds: f.impactSeconds ?? null,
          description: f.description,
          evidence: f.evidence.map((e) => ({ label: e.label, value: e.value, source: e.source })),
          affected: f.affected,
          recommendation: f.recommendation,
          verificationPath: f.verificationPath,
          remediationKind: f.remediationKind,
          experimentEligible: f.experimentEligible ?? false,
        })),
    },
    graph: {
      duplicates: graph.duplicates.map((d) => ({
        name: d.name,
        versions: d.versions,
        dependents: d.dependents,
        wastedSeconds: d.wastedSeconds,
      })),
      blastTop: [...graph.blast]
        .sort((a, b) => b.affectedWorkspace - a.affectedWorkspace)
        .slice(0, 5)
        .map((b) => ({
          file: b.file,
          crate: b.crate,
          affectedWorkspace: b.affectedWorkspace,
          incrementalDelta: b.incrementalDelta,
        })),
    },
    pr: {
      number: pr.number,
      title: pr.title,
      state: pr.state ?? 'open',
      regressionPct: pr.regressionPct,
      affectedCrates: pr.affectedCrates,
      confidencePct: pr.confidence,
      confidenceClass: pr.confidenceClass,
    },
    experiments: experiments.experiments.map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      improvementPct: e.improvementPct ?? null,
      claim: e.claim,
    })),
    gates: {
      verdict: GATES.verdict,
      rationale: GATES.rationale,
      gates: GATES.gates.map((g) => ({
        id: g.id,
        name: g.name,
        target: g.target,
        measured: g.measured,
        status: g.status,
        blocking: g.blocking,
      })),
    },
    storage: {
      rows: storage.rows.map((r) => ({ label: r.label, sizeMB: r.sizeMB, reclaimable: r.reclaimable })),
      totalMB: storage.totalMB,
      lastGc: storage.lastGc,
      retention: storage.retention,
      bound: storage.bound,
      note: 'Simulated in-process state — resets when the demo server restarts.',
    },
    honestyNotes: [
      'All figures labeled `estimated` come from build telemetry × graph traversal simulation and are NOT measured results until a wanyrix experiment verifies them (Gate 21).',
      'Findings carry stable IDs and per-claim evidence with source attribution; nothing was auto-applied to any repository (Gate 19).',
      'AI (when connected) only adds grounded explanations on top of deterministic analysis; it never edits code silently.',
    ],
  }

  const filename = `wanyrix-report-${ws}-${now.toISOString().slice(0, 10)}.json`
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length
  return { filename, json: payload, bytes }
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
  push(`# Wanyrix workspace report — ${ws}`)
  push()
  push(
    `> Generated ${now.toISOString()} · wanyrix web demo v0.4.2 · findings carry stable IDs + evidence (Gate 11) · estimates are labeled, never silently mixed with measured values (Gate 21)`,
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
  push('## Build intelligence — wanyrix doctor')
  push()
  push(
    `- Profile: \`${doctor.profile}\` · Toolchain: \`${doctor.toolchain}\``,
  )
  push(
    `- Build time: **${doctor.buildTime.toFixed(1)}s** (estimated after top fix: ${doctor.estimatedRange[0].toFixed(1)}–${doctor.estimatedRange[1].toFixed(1)}s · confidence ${doctor.confidence}%)`,
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
  push(
    `Served backbone: ${graph.meta.servedNodes} nodes · ${graph.meta.servedEdges} edges (subset of the full ${graph.meta.workspaceCrates}-crate workspace graph · ${graph.meta.totalEdges} edges) · per-node aggregates computed from the served edges · last scan ${graph.meta.lastScan}`,
  )
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
    '- All figures labeled `estimated` come from build telemetry × graph traversal simulation and are NOT measured results until a wanyrix experiment verifies them (Gate 21).',
  )
  push('- Findings carry stable IDs and per-claim evidence with source attribution; nothing in this report was auto-applied to any repository (Gate 19).')
  push('- Storage numbers are simulated in-process state and reset when the demo server restarts.')
  push('- AI (when connected) only adds grounded explanations on top of deterministic analysis; it never edits code silently.')

  const markdown = L.join('\n')
  const filename = `wanyrix-report-${ws}-${now.toISOString().slice(0, 10)}.md`
  return { schema: 'wanyrix.markdown/v1', filename, markdown, bytes: new TextEncoder().encode(markdown).length }
}

/* ========================================================================= */
/*  Explain-route grounding helpers (Task 2-d — ENG-TCA-4 / ENG-TCA-7).       */
/*  Pure functions: parse the model's labeled sections, validate every       */
/*  number/status/reference against the server-derived evidence corpus, and  */
/*  redact violations. The server-rendered FACT block never passes through   */
/*  the model; these helpers only police the model's own labeled fields.     */
/* ========================================================================= */

/** Hard request cap for POST /api/wanyrix/explain (ENG-TCA-7). */
export const EXPLAIN_MAX_BODY_BYTES = 256 * 1024 // 256 KB

/** Characters of evidence context forwarded to the AI provider (prompt cap). */
export const EXPLAIN_MAX_PROMPT_CONTEXT_CHARS = 48_000

/** The four model-owned fields. There is deliberately NO `fact` field: facts
 *  are rendered server-side from context and are not model-writable. */
export interface ExplainModelSections {
  /** model prose under OBSERVED FACT — demoted to commentary, never evidence */
  commentary: string
  inference: string
  recommendation: string
  uncertainty: string
}

export interface GroundingViolation {
  kind: 'number' | 'status' | 'reference'
  /** the offending token as it appeared in the model text */
  token: string
  /** which model field carried it */
  field: keyof ExplainModelSections
  detail: string
}

const SECTION_LABELS: { key: keyof ExplainModelSections; re: RegExp }[] = [
  { key: 'commentary', re: /OBSERVED\s*FACT\s*[—:-]/i },
  { key: 'inference', re: /INFERENCE\s*[—:-]/i },
  { key: 'recommendation', re: /RECOMMENDATION\s*[—:-]/i },
  { key: 'uncertainty', re: /UNCERTAINTY\s*[—:-]/i },
]

/**
 * Split the model's answer into its labeled sections. Any text under the
 * OBSERVED FACT label is stored as `commentary` — the model cannot write into
 * the response's server-rendered fact block, so the strongest epistemic label
 * it can reach is commentary (ENG-TCA-4).
 */
export function parseModelSections(text: string): ExplainModelSections {
  const out: ExplainModelSections = { commentary: '', inference: '', recommendation: '', uncertainty: '' }
  if (!text) return out

  // Locate every label occurrence with its position.
  const hits: { key: keyof ExplainModelSections; start: number; end: number }[] = []
  for (const { key, re } of SECTION_LABELS) {
    const global = new RegExp(re.source, 'gi')
    let m: RegExpExecArray | null
    while ((m = global.exec(text)) !== null) {
      hits.push({ key, start: m.index, end: m.index + m[0].length })
    }
  }
  if (hits.length === 0) {
    // No labels at all — the whole text is commentary.
    out.commentary = text.trim()
    return out
  }
  hits.sort((a, b) => a.start - b.start)
  if (hits[0].start > 0) out.commentary = `${text.slice(0, hits[0].start).trim()}\n${out.commentary}`.trim()
  for (let i = 0; i < hits.length; i++) {
    const body = text.slice(hits[i].end, i + 1 < hits.length ? hits[i + 1].start : undefined).trim()
    out[hits[i].key] = out[hits[i].key] ? `${out[hits[i].key]}\n${body}` : body
  }
  return out
}

const NUMBER_RE = /\d+(?:\.\d+)?/g
const STATUS_WORD_RE = /\b(measured|verified|proven|confirmed)\b/i
/** EXP-014 / FER-BLD-001 / WAN-110 — stable registry-style ids. */
const ID_LIKE_RE = /\b[A-Z]{2,}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g
/** Quoted or backticked names ('totally-real-crate-xyz'). */
const QUOTED_NAME_RE = /['"`]([a-z0-9][a-z0-9-]{5,})['"`]/g

/**
 * Validate the model's own fields against the evidence corpus (fact statements
 * + raw context + resolved registry record, stringified). Returns every token
 * the model asserted that the evidence does not contain.
 */
export function validateModelGrounding(
  sections: ExplainModelSections,
  evidenceCorpus: string,
): GroundingViolation[] {
  const violations: GroundingViolation[] = []
  const corpus = evidenceCorpus.toLowerCase()
  const fields: (keyof ExplainModelSections)[] = ['commentary', 'inference', 'recommendation', 'uncertainty']

  for (const field of fields) {
    const text = sections[field]
    if (!text) continue

    // 1. numbers — every number the model asserts must exist in the evidence
    const seen = new Set<string>()
    for (const m of text.match(NUMBER_RE) ?? []) {
      if (seen.has(m)) continue
      seen.add(m)
      if (!corpus.includes(m.toLowerCase())) {
        violations.push({ kind: 'number', token: m, field, detail: `number ${m} does not appear in the evidence context` })
      }
    }

    // 2. status words — never upgrade: measured/verified/proven/confirmed must
    //    already be established by the evidence corpus
    const status = text.match(STATUS_WORD_RE)
    if (status && !corpus.includes(status[1].toLowerCase())) {
      violations.push({
        kind: 'status',
        token: status[1],
        field,
        detail: `claims "${status[1]}" but the evidence context never establishes that status`,
      })
    }

    // 3. id-like references (EXP-014, FER-BLD-001, …) must exist in the corpus
    const seenIds = new Set<string>()
    for (const m of text.match(ID_LIKE_RE) ?? []) {
      if (seenIds.has(m)) continue
      seenIds.add(m)
      if (!corpus.includes(m.toLowerCase())) {
        violations.push({ kind: 'reference', token: m, field, detail: `references ${m}, which is not present in the evidence context` })
      }
    }

    // 4. quoted hyphenated names ('totally-real-crate-xyz') must exist too
    const seenNames = new Set<string>()
    for (const m of text.matchAll(QUOTED_NAME_RE)) {
      const name = m[1]
      if (!name || seenNames.has(name)) continue
      seenNames.add(name)
      if (!corpus.includes(name.toLowerCase())) {
        violations.push({ kind: 'reference', token: name, field, detail: `names "${name}", which is not present in the evidence context` })
      }
    }
  }
  return violations
}

/**
 * The literal token {@link redactViolations} writes into quarantined model
 * text. Wire/render contract — pinned by tests/unit/explain-grounding.test.ts.
 */
export const GROUNDING_REDACTED_TOKEN = '⟨removed: not in evidence⟩'

/**
 * Explicit honest omission label for a redacted *template slot* (issue #130):
 * when a computed-delta slot like "(+8.7ms)" loses its number to redaction,
 * the whole slot renders as this label instead of a bare placeholder like
 * "(+—ms)" — the reader sees an explicit omission, never an unfilled template.
 */
export const GROUNDING_OMISSION_LABEL = '(delta unavailable)'

/** Redact violating tokens in place so quarantined model text is safe to inspect. */
export function redactViolations(sections: ExplainModelSections, violations: GroundingViolation[]): ExplainModelSections {
  const out: ExplainModelSections = { ...sections }
  for (const v of violations) {
    const token = v.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out[v.field] = out[v.field].replace(new RegExp(token, 'g'), GROUNDING_REDACTED_TOKEN)
  }
  return out
}

/**
 * Repair redacted *template slots* (issue #130). A redaction token that lands
 * inside a parenthesized numeric slot — "(+⟨removed⟩ms)", "(⟨removed⟩ s)" —
 * renders as the explicit omission label {@link GROUNDING_OMISSION_LABEL};
 * mid-sentence redactions keep the #99 em-dash. Pure presentation either way:
 * the ungrounded claim stays removed, nothing is fabricated in its place.
 */
export function repairRedactedSlots(text: string): string {
  const escaped = GROUNDING_REDACTED_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(
    new RegExp(`\\(\\s*\\+?\\s*${escaped}\\s*[a-zA-Z%]{0,4}\\s*\\)`, 'g'),
    GROUNDING_OMISSION_LABEL,
  )
}

/**
 * Presentation smoothing for quarantined model prose (issue #99 P4): the raw
 * redaction token is machine-honest but reads terribly inside a sentence —
 * the UI renders an em-dash in its place instead. The claim is still REMOVED
 * (never fabricated, never re-labeled); the prose just stops shouting angle
 * brackets at the reader. The server-side token itself is unchanged.
 *
 * Issue #130: a token that landed inside a parenthesized template slot is
 * repaired to the explicit omission label first, so a computed-delta slot
 * can never render as a bare "(+—ms)" placeholder.
 */
export function smoothGroundedProse(text: string): string {
  return repairRedactedSlots(text).split(GROUNDING_REDACTED_TOKEN).join('—')
}

/* ------------------------------------------------------ unit alignment ---- */

/** One model duration-unit relabel, surfaced verbatim in the response. */
export interface UnitRelabel {
  /** which model-owned field carried the token */
  field: keyof ExplainModelSections
  /** the token as the model wrote it, e.g. "8.2ms" */
  from: string
  /** what replaced it, e.g. "8.2s" */
  to: string
}

const MS_DURATION_RE = /\b(\d+(?:\.\d+)?)\s?ms\b/g

/**
 * Issue #137 — provider prose durations in word form ("4 minutes", "2.5 hours",
 * "30 seconds"). The app convention is seconds everywhere, and #130's ms rule
 * only covered the "ms" token, so word-unit prose slipped through grounding
 * whenever its bare number was grounded by an unrelated fact ("4 minutes"
 * surviving on the strength of "4 downstream crates").
 */
const WORD_DURATION_RE = /\b(\d+(?:\.\d+)?)\s?(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/gi

/**
 * Issue #137 P4 nit — compact compound durations ("14m12s", "1h5m", "1h5m30s",
 * with optional spaces). Only an evidence-stated total is converted; there is
 * no bare-number fallback because a compound token has no single number to
 * keep grounded.
 */
const COMPACT_DURATION_RE =
  /\b(\d+(?:\.\d+)?)\s?h\s?(\d+(?:\.\d+)?)\s?m(?:\s?(\d+(?:\.\d+)?)\s?s)?\b|\b(\d+(?:\.\d+)?)\s?m\s?(\d+(?:\.\d+)?)\s?s\b/gi

/** Multiplier to the app's canonical unit (seconds) per recognized word unit. */
const WORD_UNIT_SECONDS: Record<string, number> = {
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
}

/** Canonical seconds numeral — "240", "852", "865.5" (no trailing zeros). */
const canonicalSeconds = (value: number): string => String(Math.round(value * 100) / 100)

/**
 * Align model-asserted duration units with the app convention (issues #130, #137).
 *
 * The evidence corpus is the only unit authority:
 *  - a "Nms" claim survives verbatim when the corpus itself states "Nms"
 *    (some engine metrics genuinely are milliseconds, e.g. "startup 84ms");
 *  - when the corpus states only the bare number N, the token is relabeled to
 *    seconds — the convention every Wanyrix surface uses for build-time
 *    metrics (overview trend axis "incremental (s)", insight text
 *    "6.1s → 12.1s", server-derived facts "8.2s"). The NUMBER is untouched —
 *    only the unit label follows the app's, so nothing is invented;
 *  - when the corpus states neither, the token is left for
 *    {@link validateModelGrounding} to redact — an ungrounded number never
 *    gets blessed with a unit.
 *
 * Issue #137 extends the same contract to provider prose durations:
 *  - word form ("4 minutes", "2.5 hours", "30 seconds") — converted to the
 *    canonical seconds form when the evidence states the exact seconds value
 *    ("save 2 minutes per run" over a corpus saying "save 120s per run"
 *    becomes "120s"); otherwise the unit is relabeled with the number kept
 *    untouched when the bare number is grounded ("4 minutes" → "4s", the #130
 *    rule); otherwise left verbatim for the validator to redact;
 *  - a token the corpus itself states verbatim ("3 minutes" in a heuristic
 *    budget) survives — the evidence may genuinely speak in minutes;
 *  - compact compounds ("14m12s", "1h5m30s") convert only to an
 *    evidence-stated total ("14m12s" over "cold start 852s" → "852s").
 *
 * Every rewrite is recorded in the returned relabels and surfaced verbatim in
 * the explain response (`unitRelabels`), so unit alignment stays auditable.
 */
export function normalizeGroundedUnits(
  sections: ExplainModelSections,
  evidenceCorpus: string,
): { sections: ExplainModelSections; relabels: UnitRelabel[] } {
  const corpus = evidenceCorpus.toLowerCase()
  const out: ExplainModelSections = { ...sections }
  const relabels: UnitRelabel[] = []
  const fields: (keyof ExplainModelSections)[] = ['commentary', 'inference', 'recommendation', 'uncertainty']

  for (const field of fields) {
    const text = out[field]
    if (!text) continue
    let updated = text.replace(MS_DURATION_RE, (match: string, num: string) => {
      if (corpus.includes(match.trim().toLowerCase())) return match // evidence states this exact ms value
      if (!corpus.includes(num.toLowerCase())) return match // number itself ungrounded → validator redacts
      const seconds = `${Number(num).toFixed(1)}s`
      relabels.push({ field, from: match.trim(), to: seconds })
      return seconds
    })

    // Issue #137 (P4 nit) — compact compounds: "1h5m30s" / "1h5m" / "14m12s".
    updated = updated.replace(
      COMPACT_DURATION_RE,
      (match: string, h?: string, hm?: string, hs?: string, m?: string, s?: string) => {
        if (corpus.includes(match.trim().toLowerCase())) return match // evidence states this exact compound
        const hours = h !== undefined ? Number(h) : 0
        const minutes = h !== undefined ? Number(hm) : Number(m)
        const seconds = h !== undefined ? (hs !== undefined ? Number(hs) : 0) : Number(s)
        const total = canonicalSeconds(hours * 3600 + minutes * 60 + seconds)
        if (!corpus.includes(`${total}s`)) return match // total not evidenced → left for the validator
        relabels.push({ field, from: match.trim(), to: `${total}s` })
        return `${total}s`
      },
    )

    // Issue #137 — word-form durations: "30 seconds", "4 minutes", "2.5 hours".
    updated = updated.replace(WORD_DURATION_RE, (match: string, num: string, unit: string) => {
      if (corpus.includes(match.trim().toLowerCase())) return match // evidence itself speaks in this unit
      const seconds = canonicalSeconds(Number(num) * WORD_UNIT_SECONDS[unit.toLowerCase()])
      if (corpus.includes(`${seconds}s`)) {
        // the evidence states the exact seconds value — convert to canonical form
        relabels.push({ field, from: match.trim(), to: `${seconds}s` })
        return `${seconds}s`
      }
      if (corpus.includes(num.toLowerCase())) {
        // bare number grounded → the unit label follows the app convention (#130 rule)
        relabels.push({ field, from: match.trim(), to: `${num}s` })
        return `${num}s`
      }
      return match // number itself ungrounded → validator redacts
    })

    out[field] = updated
  }
  return { sections: out, relabels }
}
