#!/usr/bin/env bun
/**
 * fixture-gen — deterministic SYNTHETIC workspace fixture generator (issue #53).
 *
 * Generates internally consistent fixture data for an arbitrary workspace size
 * from a single seed: dependency-graph nodes/edges (with derived fan-in /
 * fan-out / downstream aggregates), doctor findings that reference real
 * generated crates, and doctor KPIs (severity / section counts derived from
 * the findings array). The same graph math as the served web fixtures
 * (computeGraphMath in src/lib/wanyrix/fixtures/graph.ts) is reused so
 * aggregates are provably derivable from the emitted edge list.
 *
 * HONESTY CONTRACT: this tool emits SYNTHETIC data, never engine measurements.
 * Every emitted JSON file therefore carries top-level `synthetic: true`,
 * `generator: "fixture-gen v1"` and the `seed` so it can never be confused
 * with measured wanyrix-engine output. Output is fully deterministic for a
 * given (crates, seed) pair — no wall-clock, no Math.random.
 *
 * Usage:
 *   bun scripts/fixture-gen.ts --crates 20 --seed 7 --out /tmp/wsx
 *   bun scripts/fixture-gen.ts                     # defaults: 20 crates, seed 7
 *
 * Output defaults to /tmp/wanyrix-fixture-gen/<name>/ (this repo intentionally
 * does not commit generated data and its .gitignore is not touched; pass
 * --out to write anywhere you own). Exit codes: 0 generated+validated,
 * 1 validation failed, 2 usage error.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

import { computeGraphMath, type RawGraphNode } from '../src/lib/wanyrix/fixtures/graph'
import type { Finding, GraphEdge, GraphNode, HealthPayload } from '../src/lib/wanyrix/types'

const GENERATOR = 'fixture-gen v1'
const SCAN_DATE = '2026-01-01T00:00:00Z' // fixed — determinism over realism
const TOOLCHAIN = 'rustc 1.84.1 (fixture-gen synthetic) · cargo 1.84.0'
const MAX_CRATES = 120

/* --------------------------------------------------------------- prng --- */

/** xmur3 string hash → 32-bit seed, then mulberry32 — tiny, dependency-free, stable. */
function makeRng(seedText: string): () => number {
  let h = 1779033703 ^ seedText.length
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const int = (rng: () => number, maxExclusive: number) => Math.floor(rng() * maxExclusive)
const pick = <T,>(rng: () => number, xs: T[]): T => xs[int(rng, xs.length)]
const round1 = (n: number) => Math.round(n * 10) / 10

function shuffled<T>(rng: () => number, xs: T[]): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(rng, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/* -------------------------------------------------------------- pools --- */

const ADJECTIVES = [
  'swift', 'amber', 'north', 'core', 'blue', 'iron', 'delta', 'quiet',
  'ember', 'crisp', 'vivid', 'solid',
]
const NOUNS = [
  'cache', 'stream', 'ledger', 'relay', 'mesh', 'vault', 'beacon', 'kernel',
  'socket', 'pillar', 'quanta', 'socket',
]

const EXTERNAL_POOL: { id: string; buildTime: number; macro?: string }[] = [
  { id: 'tokio', buildTime: 8.2, macro: 'tokio-macros' },
  { id: 'serde', buildTime: 6.1, macro: 'serde_derive' },
  { id: 'syn', buildTime: 7.8 },
  { id: 'quote', buildTime: 1.9 },
  { id: 'proc-macro2', buildTime: 1.5 },
  { id: 'hyper', buildTime: 5.3 },
  { id: 'rustls', buildTime: 4.9 },
  { id: 'ring', buildTime: 3.8 },
  { id: 'tracing', buildTime: 2.4 },
  { id: 'anyhow', buildTime: 1.2 },
  { id: 'thiserror', buildTime: 1.1, macro: 'thiserror-impl' },
  { id: 'uuid', buildTime: 2.1 },
  { id: 'clap', buildTime: 3.1, macro: 'clap_derive' },
  { id: 'bytes', buildTime: 0.5 },
]

/** Externals that anchor the proc-macro backbone — always present. */
const MACRO_BACKBONE = ['syn', 'quote', 'proc-macro2']

interface GeneratedGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  workspaceCrates: string[]
  duplicates: { name: string; versions: string[]; wastedSeconds: number }[]
}

/* ----------------------------------------------------------- generate --- */

function generateGraph(crates: number, seed: number): GeneratedGraph {
  const rng = makeRng(`fixture-gen v1/${crates}/${seed}`)

  // workspace-kind crate names — unique by construction (pool shuffle + index)
  const comboPool = shuffled(
    rng,
    ADJECTIVES.flatMap((a) => NOUNS.map((n) => `${a}-${n}`)),
  )
  const crateNames = Array.from({ length: crates }, (_, i) => {
    const base = comboPool[i % comboPool.length]
    return i < comboPool.length ? base : `${base}-${i}`
  })

  const externals = [...MACRO_BACKBONE]
  const optional = shuffled(
    rng,
    EXTERNAL_POOL.filter((e) => !MACRO_BACKBONE.includes(e.id)),
  )
  const extraCount = Math.min(optional.length, 4 + Math.floor(crates / 8))
  for (const e of optional.slice(0, extraCount)) externals.push(e.id)

  const macroNodes = EXTERNAL_POOL.filter(
    (e) => e.macro && externals.includes(e.id),
  ).map((e) => e.macro as string)

  const externalsSet = new Set(externals)
  const byId = new Map<string, RawGraphNode>()
  const edges: GraphEdge[] = []
  const addEdge = (from: string, to: string) => {
    if (from !== to && !edges.some((e) => e.from === from && e.to === to)) {
      edges.push({ from, to })
    }
  }

  const externalById = new Map(EXTERNAL_POOL.map((e) => [e.id, e]))
  for (const id of externals) {
    const pool = externalById.get(id)
    byId.set(id, {
      id,
      band: 'external',
      kind: 'external',
      buildTime: pool ? pool.buildTime : round1(1 + rng() * 4),
      changeFreq: 0,
    })
  }
  for (const id of macroNodes) {
    byId.set(id, {
      id,
      band: 'external',
      kind: 'proc-macro',
      buildTime: round1(1.2 + rng() * 4),
      changeFreq: 0,
    })
  }
  crateNames.forEach((id, i) => {
    byId.set(id, {
      id,
      band: i < Math.min(3, crates) ? 'bin' : 'lib',
      kind: 'workspace',
      buildTime: round1(1 + rng() * 16),
      changeFreq: int(rng, 41),
    })
  })

  // externals → proc-macros → syn → proc-macro2 (fixed backbone, cargo-style)
  for (const e of EXTERNAL_POOL) {
    if (externalsSet.has(e.id) && e.macro && macroNodes.includes(e.macro)) {
      addEdge(e.id, e.macro)
    }
  }
  for (const m of macroNodes) addEdge(m, 'syn')
  addEdge('syn', 'proc-macro2')
  addEdge('quote', 'proc-macro2')

  // workspace crates depend on earlier crates (DAG, no cycles) + externals
  crateNames.forEach((id, i) => {
    const internalCount = i === 0 ? 0 : 1 + int(rng, 2)
    const earlier = shuffled(
      rng,
      Array.from({ length: i }, (_, j) => crateNames[j]),
    )
    for (const dep of earlier.slice(0, internalCount)) addEdge(id, dep)
    const extCount = 1 + int(rng, 2)
    for (const dep of shuffled(rng, externals).slice(0, extCount)) addEdge(id, dep)
  })

  // derived aggregates — the single source of truth (same math as the web app);
  // computed over ALL nodes so externals/proc-macros carry real degrees too
  const math = computeGraphMath([...byId.values()], edges)

  // duplicate-version groups on two non-backbone externals (or any, if tiny);
  // flagged on byId BEFORE the emitted nodes are materialized from it
  const dupCandidates = shuffled(
    rng,
    externals.filter((e) => !MACRO_BACKBONE.includes(e)),
  )
  const dupCount = Math.min(2, dupCandidates.length)
  const duplicates = dupCandidates.slice(0, dupCount).map((name) => {
    const v1 = `${int(rng, 2)}.${1 + int(rng, 40)}.${int(rng, 13)}`
    const v2 = `${int(rng, 2)}.${1 + int(rng, 40)}.${int(rng, 13)}`
    return { name, versions: [v1, v2], wastedSeconds: byId.get(name)?.buildTime ?? 1 }
  })
  for (const d of duplicates) {
    const node = byId.get(d.name)
    if (node) {
      node.duplicate = true
      node.versions = d.versions
    }
  }

  const nodes: GraphNode[] = [...byId.values()].map((n) => ({
    ...n,
    fanIn: math.fanIn[n.id] ?? 0,
    fanOut: math.fanOut[n.id] ?? 0,
    downstream: math.downstream[n.id] ?? 0,
  }))

  // `critical` flags are derived too: the two highest fan-in workspace crates
  const workspaceByFanIn = nodes
    .filter((n) => n.kind === 'workspace')
    .sort((a, b) => b.fanIn - a.fanIn || a.id.localeCompare(b.id))
  for (const n of workspaceByFanIn.slice(0, 2)) n.critical = true

  return { nodes, edges, workspaceCrates: crateNames, duplicates }
}

/* ----------------------------------------------------------- findings --- */

interface GeneratedFixtures {
  workspaceName: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  findings: Finding[]
  duplicates: GeneratedGraph['duplicates']
  buildTime: number
}

function generateFixtures(crates: number, seed: number): GeneratedFixtures {
  const rng = makeRng(`fixture-gen findings/${crates}/${seed}`)
  const { nodes, edges, workspaceCrates, duplicates } = generateGraph(crates, seed)
  const workspaceName = `synthetic-ws-${crates}c-seed${seed}`
  const workspaceNodes = nodes.filter((n) => n.kind === 'workspace')
  const buildTime = round1(workspaceNodes.reduce((s, n) => s + n.buildTime, 0))

  let seq = 0
  const fid = (prefix: string) => `SYN-${prefix}-${String(++seq).padStart(3, '0')}`
  const topDependents = (id: string, k: number): string[] => {
    // dependents of `id` are edges `from → id`; deterministic node order
    const deps = edges.filter((e) => e.to === id).map((e) => e.from)
    const order = new Map(nodes.map((n, i) => [n.id, i]))
    return deps.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)).slice(0, k)
  }

  const findings: Finding[] = []

  // 1 · critical path / change-amplifier finding on the worst workspace crate
  const worst = [...workspaceNodes].sort(
    (a, b) => b.downstream - a.downstream || b.buildTime - a.buildTime || a.id.localeCompare(b.id),
  )[0]
  findings.push({
    id: fid('BLD'),
    section: 'Build',
    severity: 'critical',
    title: `${worst.id} dominates the synthetic critical path`,
    description: `In this SYNTHETIC workspace ${worst.id} compiles ${worst.buildTime}s of the ${buildTime}s dev build, ${worst.downstream} workspace crates depend on it transitively, and it changed ${worst.changeFreq} times in the last 90 days.`,
    evidence: [
      { label: 'Build time', value: `${worst.buildTime}s`, source: 'synthetic cargo build --timings' },
      { label: 'Downstream crates', value: String(worst.downstream), source: 'synthetic graph closure' },
      { label: 'Changes (90d)', value: `${worst.changeFreq} commits`, source: 'synthetic git log' },
    ],
    affected: [worst.id, ...topDependents(worst.id, 3)],
    impact: `Median incremental build invalidates ${worst.downstream} workspace crates whenever ${worst.id} is touched`,
    impactSeconds: worst.buildTime,
    recommendation: `Split ${worst.id} into a stable types crate and a volatile implementation crate.`,
    remediationKind: 'architecture',
    verificationPath: `Experiment: blast radius of ${worst.id} drops ${worst.downstream} → ≤4 crates (5-run median).`,
    confidenceClass: 'high',
    confidence: 78 + int(rng, 15),
    detection: 'critical-path analysis over the synthetic graph',
    measurementStatus: 'estimated',
    experimentEligible: true,
  })

  // 2 · one warning per duplicate-version group — references a real dependent
  for (const d of duplicates) {
    const dependent = topDependents(d.name, 1)[0] ?? workspaceCrates[0]
    findings.push({
      id: fid('DEP'),
      section: 'Dependencies',
      severity: 'warning',
      title: `two versions of ${d.name} compiled simultaneously`,
      description: `${d.name} ${d.versions[0]} and ${d.versions[1]} both compile in this SYNTHETIC workspace — duplicated work of ${d.wastedSeconds}s per clean build.`,
      evidence: [
        { label: 'Versions', value: d.versions.join(' · '), source: 'synthetic cargo tree -d' },
        { label: 'Wasted', value: `${d.wastedSeconds}s clean`, source: 'synthetic cargo build --timings' },
      ],
      affected: [d.name, dependent],
      impact: 'Clean builds pay double compilation for one logical dependency',
      impactSeconds: d.wastedSeconds,
      recommendation: `Unify on ${d.name} ${d.versions[1]} via cargo update after fixing the importing path.`,
      remediationKind: 'command',
      verificationPath: `cargo tree -d | grep ${d.name} must list a single version set.`,
      confidenceClass: 'deterministic',
      confidence: 100,
      detection: 'duplicate version scan over the synthetic Cargo.lock',
      measurementStatus: 'measured',
    })
  }

  // 3 · change-amplifier warning (highest churn × fan-in workspace crate)
  const amplifier = [...workspaceNodes].sort(
    (a, b) => b.changeFreq * (b.fanIn + 1) - a.changeFreq * (a.fanIn + 1) || a.id.localeCompare(b.id),
  )[0]
  findings.push({
    id: fid('WRK'),
    section: 'Workspace',
    severity: 'warning',
    title: `${amplifier.id} is a change-amplifier`,
    description: `${amplifier.id} changed ${amplifier.changeFreq} times in 90 days and ${amplifier.fanIn} crates depend on it directly (SYNTHETIC fixture numbers).`,
    evidence: [
      { label: 'Dependents', value: `${amplifier.fanIn} crates`, source: 'synthetic graph fan-in' },
      { label: 'Changes (90d)', value: `${amplifier.changeFreq} commits`, source: 'synthetic git log' },
    ],
    affected: [amplifier.id, ...topDependents(amplifier.id, 2)],
    impact: 'Highest churn × widest fan-out combination in the synthetic workspace',
    impactSeconds: round1(amplifier.buildTime * 0.6),
    recommendation: `Extract stable abstractions from ${amplifier.id} so downstream crates depend on the stable part.`,
    remediationKind: 'architecture',
    verificationPath: `Experiment: blast radius of ${amplifier.id} drops ${amplifier.downstream} → ≤5 crates.`,
    confidenceClass: 'high',
    confidence: 74 + int(rng, 15),
    detection: 'change-frequency × fan-in correlation',
    measurementStatus: 'estimated',
    experimentEligible: true,
  })

  // 4 · IDE info finding
  const ideCrate = [...workspaceNodes].sort(
    (a, b) => b.buildTime - a.buildTime || a.id.localeCompare(b.id),
  )[0]
  findings.push({
    id: fid('IDE'),
    section: 'IDE',
    severity: 'info',
    title: `rust-analyzer check compiles ${ideCrate.id} test binaries on every save`,
    description: `flycheck runs cargo check --all-targets, compiling ${ideCrate.id} (${ideCrate.buildTime}s) on every save in this SYNTHETIC workspace.`,
    evidence: [
      { label: 'Flycheck time', value: `p50 ${ideCrate.buildTime}s`, source: 'synthetic rust-analyzer stats' },
    ],
    affected: [ideCrate.id],
    impact: 'Slow in-IDE feedback loop during work on the heaviest crate',
    recommendation: 'Set rust-analyzer check.invocationStrategy = once and exclude test targets from flycheck.',
    remediationKind: 'config',
    verificationPath: 'rust-analyzer flycheck p50 must drop below 4s.',
    confidenceClass: 'medium',
    confidence: 68 + int(rng, 15),
    detection: 'IDE telemetry sampling (synthetic)',
    measurementStatus: 'measured',
  })

  // 5 · async info finding — only when the workspace is big enough to earn one
  if (crates >= 8) {
    const ioCrate = pick(rng, workspaceNodes)
    findings.push({
      id: fid('ASY'),
      section: 'Async',
      severity: 'info',
      title: `blocking file IO inside ${ioCrate.id} runtime worker`,
      description: `${ioCrate.id}/src/writer.rs calls std::fs::write on the tokio worker thread — p95 stall of 180ms in this SYNTHETIC fixture.`,
      evidence: [
        { label: 'Location', value: `${ioCrate.id}/src/writer.rs`, source: 'synthetic static analysis' },
        { label: 'Worker stall', value: 'p95 180ms', source: 'synthetic tokio-console telemetry' },
      ],
      affected: [ioCrate.id],
      impact: 'Latency spikes under load; no build-time claim',
      recommendation: 'Wrap writer IO in tokio::task::spawn_blocking or move to tokio::fs.',
      remediationKind: 'patch',
      verificationPath: 'tokio-console: writer stall p95 must drop below 10ms.',
      confidenceClass: 'deterministic',
      confidence: 100,
      detection: 'async blocking-call static analysis (synthetic)',
      measurementStatus: 'measured',
    })
  }

  return { workspaceName, nodes, edges, findings, duplicates, buildTime }
}

/* ------------------------------------------------------------- doctor --- */

interface DoctorFixture {
  workspace: string
  profile: string
  toolchain: string
  buildTime: number
  estimatedRange: [number, number]
  confidence: number
  criticalPath: { name: string; seconds: number; kind: 'workspace' | 'external' | 'proc-macro' | 'linker' }[]
  findings: Finding[]
  scannedAt: string
  phases: { label: string; detail: string }[]
  summary: { developerBuild: string; ciBuild: string; diskUsage: string }
  severityCounts: Record<string, number>
  findingCounts: { section: string; count: number }[]
  kpis: Pick<
    HealthPayload['kpis'],
    'buildPerformance' | 'ciCost' | 'dependencyRisk' | 'prRegressions' | 'architectureDebt' | 'runtimeBottlenecks'
  >
}

function buildDoctor(fx: GeneratedFixtures, seed: number): DoctorFixture {
  const rng = makeRng(`fixture-gen doctor/${fx.nodes.length}/${seed}`)
  const workspaceNodes = fx.nodes.filter((n) => n.kind === 'workspace')
  const severityCounts: Record<string, number> = { critical: 0, warning: 0, info: 0 }
  for (const f of fx.findings) severityCounts[f.severity] = (severityCounts[f.severity] ?? 0) + 1
  const sectionOrder = ['Build', 'Dependencies', 'Workspace', 'IDE', 'Async']
  const findingCounts = sectionOrder
    .map((section) => ({ section, count: fx.findings.filter((f) => f.section === section).length }))
    .filter((s) => s.count > 0)

  const criticalPath = [
    ...[...workspaceNodes]
      .sort((a, b) => b.buildTime - a.buildTime || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((n) => ({ name: n.id, seconds: n.buildTime, kind: 'workspace' as const })),
    ...fx.nodes
      .filter((n) => n.kind === 'proc-macro')
      .slice(0, 1)
      .map((n) => ({ name: n.id, seconds: n.buildTime, kind: 'proc-macro' as const })),
    ...fx.nodes
      .filter((n) => n.kind === 'external')
      .sort((a, b) => b.buildTime - a.buildTime || a.id.localeCompare(b.id))
      .slice(0, 2)
      .map((n) => ({ name: n.id, seconds: n.buildTime, kind: 'external' as const })),
    { name: 'linking + codegen', seconds: round1(fx.buildTime * 0.18), kind: 'linker' as const },
  ]

  return {
    workspace: fx.workspaceName,
    profile: 'dev',
    toolchain: TOOLCHAIN,
    buildTime: fx.buildTime,
    estimatedRange: [Math.round(fx.buildTime * 0.55), Math.round(fx.buildTime * 0.72)],
    confidence: 70 + int(rng, 16),
    criticalPath,
    findings: fx.findings,
    scannedAt: SCAN_DATE,
    phases: [
      { label: 'Parsing cargo metadata', detail: `${fx.nodes.filter((n) => n.kind === 'workspace').length} workspace crates · ${fx.edges.length} edges` },
      { label: 'Reading Cargo.lock', detail: `${fx.duplicates.length} duplicate version groups found` },
      { label: 'Ingesting build timings', detail: `synthetic cargo build --timings · dev profile · ${fx.buildTime}s` },
      { label: 'Deriving graph aggregates', detail: 'fanIn/fanOut/downstream computed from the served edge list' },
      { label: 'Emitting findings', detail: `${fx.findings.length} findings · severity counts derived from the findings array` },
    ],
    summary: { developerBuild: '−30%', ciBuild: '−36%', diskUsage: '−22%' },
    severityCounts,
    findingCounts,
    kpis: {
      buildPerformance: { delta: -(8 + int(rng, 33)), label: 'Build performance' },
      ciCost: { delta: -(5 + int(rng, 21)), label: 'CI cost' },
      dependencyRisk: { delta: -(4 + int(rng, 21)), label: 'Dependency risk' },
      prRegressions: { count: int(rng, 3), label: 'PR build regressions' },
      architectureDebt: { count: 2 + int(rng, 12), label: 'Architecture debt' },
      runtimeBottlenecks: { count: int(rng, 7), label: 'Runtime bottlenecks' },
    },
  }
}

/* ----------------------------------------------------------- validate --- */

interface CheckResult {
  ok: boolean
  msg: string
}

function validateFixtures(fx: GeneratedFixtures, doctor: DoctorFixture): CheckResult[] {
  const checks: CheckResult[] = []
  const ids = new Set(fx.nodes.map((n) => n.id))

  const dupNodeIds = fx.nodes.filter((n, i) => fx.nodes.findIndex((m) => m.id === n.id) !== i)
  checks.push({ ok: dupNodeIds.length === 0, msg: 'node ids are unique' })

  const dangling = fx.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to))
  checks.push({ ok: dangling.length === 0, msg: 'every edge references existing nodes' })

  const selfLoop = fx.edges.some((e) => e.from === e.to)
  checks.push({ ok: !selfLoop, msg: 'no self-loop edges' })

  // acyclicity (Kahn) — a DAG is a precondition for the closure math
  const indeg = new Map([...ids].map((id) => [id, 0]))
  for (const e of fx.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  let visited = 0
  const localIndeg = new Map(indeg)
  while (queue.length > 0) {
    const cur = queue.shift() as string
    visited++
    for (const e of fx.edges.filter((x) => x.from === cur)) {
      const d = (localIndeg.get(e.to) ?? 0) - 1
      localIndeg.set(e.to, d)
      if (d === 0) queue.push(e.to)
    }
  }
  checks.push({ ok: visited === ids.size, msg: 'graph is acyclic (Kahn count == node count)' })

  // aggregates derivable from edges — recompute and compare with emitted nodes
  const rawNodes: RawGraphNode[] = fx.nodes.map(({ fanIn: _f, fanOut: _o, downstream: _d, ...rest }) => rest)
  const math = computeGraphMath(rawNodes, fx.edges)
  const aggMismatch = fx.nodes.filter(
    (n) =>
      n.fanIn !== (math.fanIn[n.id] ?? 0) ||
      n.fanOut !== (math.fanOut[n.id] ?? 0) ||
      n.downstream !== (math.downstream[n.id] ?? 0),
  )
  checks.push({ ok: aggMismatch.length === 0, msg: 'node fanIn/fanOut/downstream are derivable from edges' })

  // findings reference real crates (every affected entry is a node id)
  const badAffected = fx.findings.flatMap((f) => f.affected.filter((a) => !ids.has(a)))
  checks.push({ ok: badAffected.length === 0, msg: 'every finding.affected crate exists in nodes' })

  // severity + section counts match the findings array
  const counts: Record<string, number> = { critical: 0, warning: 0, info: 0 }
  for (const f of fx.findings) counts[f.severity]++
  const severityOk = Object.entries(counts).every(([k, v]) => doctor.severityCounts[k] === v)
  checks.push({ ok: severityOk, msg: 'severityCounts match the findings array' })

  const sectionOk = doctor.findingCounts.every(
    (s) => s.count === fx.findings.filter((f) => f.section === s.section).length,
  )
  const sectionsCovered = doctor.findingCounts.length === new Set(fx.findings.map((f) => f.section)).size
  checks.push({ ok: sectionOk && sectionsCovered, msg: 'findingCounts (by section) match the findings array' })

  const findingIds = new Set(fx.findings.map((f) => f.id))
  checks.push({ ok: findingIds.size === fx.findings.length, msg: 'finding ids are unique' })

  // duplicates reference real nodes and their node carries the same versions
  const dupOk = fx.duplicates.every((d) => {
    const node = fx.nodes.find((n) => n.id === d.name)
    return Boolean(node?.duplicate) && JSON.stringify(node?.versions) === JSON.stringify(d.versions)
  })
  checks.push({ ok: dupOk, msg: 'duplicate groups reference duplicate-flagged nodes with matching versions' })

  // doctor shape sanity
  checks.push({
    ok: Math.abs(doctor.criticalPath.filter((s) => s.kind !== 'linker').reduce((s, x) => s + x.seconds, 0)) > 0,
    msg: 'doctor criticalPath carries non-zero segments',
  })

  return checks
}

/* ---------------------------------------------------------------- cli --- */

function parseArgs(argv: string[]): { crates: number; seed: number; out?: string } {
  let crates = 20
  let seed = 7
  let out: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--crates') crates = Number(argv[++i])
    else if (a === '--seed') seed = Number(argv[++i])
    else if (a === '--out') out = argv[++i]
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!Number.isInteger(crates) || crates < 4 || crates > MAX_CRATES) {
    throw new Error(`--crates must be an integer in [4, ${MAX_CRATES}]`)
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 31 - 1) {
    throw new Error('--seed must be a non-negative integer < 2^31')
  }
  return { crates, seed, out }
}

function main(): number {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`fixture-gen: ${(err as Error).message}`)
    console.error('usage: bun scripts/fixture-gen.ts [--crates N] [--seed S] [--out DIR]')
    return 2
  }

  const { crates, seed } = opts
  const name = `ws-${crates}c-seed${seed}`
  const outDir = resolve(opts.out ?? join('/tmp', 'wanyrix-fixture-gen', name))
  const fx = generateFixtures(crates, seed)
  const doctor = buildDoctor(fx, seed)

  const envelope = () => ({ synthetic: true, generator: GENERATOR, seed, crates })
  const files: Record<string, unknown> = {
    'findings.json': { ...envelope(), workspace: fx.workspaceName, findings: fx.findings },
    'graph.json': {
      ...envelope(),
      workspace: fx.workspaceName,
      nodes: fx.nodes,
      edges: fx.edges,
      duplicates: fx.duplicates,
      meta: {
        workspaceCrates: crates,
        totalEdges: fx.edges.length,
        lastScan: SCAN_DATE,
        aggregateSource: 'served-edges',
        servedNodes: fx.nodes.length,
        servedEdges: fx.edges.length,
        note: 'SYNTHETIC fixture — every per-node aggregate is computed from the emitted edges (fixture-gen v1), never hand-typed.',
      },
    },
    'doctor.json': { ...envelope(), ...doctor },
  }

  const checks = validateFixtures(fx, doctor)

  if (checks.every((c) => c.ok)) {
    mkdirSync(outDir, { recursive: true })
    for (const [file, payload] of Object.entries(files)) {
      writeFileSync(join(outDir, file), `${JSON.stringify(payload, null, 2)}\n`)
    }
  }

  console.log(`fixture-gen v1 — synthetic workspace fixtures (NOT measured engine output)`)
  console.log(`  seed: ${seed} · crates: ${crates} · name: ${fx.workspaceName}`)
  console.log(`  nodes: ${fx.nodes.length} · edges: ${fx.edges.length} · findings: ${fx.findings.length}`)
  for (const c of checks) console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.msg}`)
  if (checks.every((c) => c.ok)) {
    console.log(`  wrote ${Object.keys(files).join(', ')} → ${outDir}`)
    return 0
  }
  console.error(`  validation FAILED — nothing written`)
  return 1
}

process.exit(main())
