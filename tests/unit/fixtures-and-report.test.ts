/**
 * Task 2-a (AUDIT-I4) — fixture builders (data.ts) + report generator (report.ts).
 *
 * Pins the product's honesty contracts as executable invariants:
 *  - versioned report flavors (`wanyrix.report/v1`);
 *  - deterministic output — same input → deep-equal output;
 *  - findings carry stable IDs, non-empty evidence, calibrated confidence;
 *  - Estimated / Measured / Verified statuses stay within the documented enum
 *    and are never conflated (Gate 21 / Gate 7).
 */
import { describe, expect, test } from 'bun:test'

import {
  getDoctor,
  getExperiments,
  getGraphPayload,
  getHealth,
  getImpact,
  getPRAnalysis,
  getWorkspaces,
} from '../../src/lib/wanyrix/data'
import {
  buildWorkspaceJsonReport,
  buildWorkspaceReport,
} from '../../src/lib/wanyrix/report'

/* ------------------------------------------------------------------ enums -- */

const MEASUREMENT_STATUSES = ['measured', 'estimated', 'verified'] as const
const CONFIDENCE_CLASSES = ['deterministic', 'high', 'medium', 'estimated'] as const
const SEVERITIES = ['critical', 'warning', 'info'] as const
const SECTIONS = ['Build', 'Workspace', 'IDE', 'CI', 'Async', 'Dependencies'] as const
const REMEDIATION_KINDS = ['command', 'config', 'architecture', 'experiment', 'patch'] as const

const WS_IDS = getWorkspaces().workspaces.map((w) => w.id)
const FROZEN_NOW = new Date('2026-09-18T12:00:00.000Z')

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

/* -------------------------------------------------------------- registry --- */

describe('workspace registry (fixture builders)', () => {
  test('exposes at least one live workspace with unique ids', () => {
    expect(WS_IDS.length).toBeGreaterThan(0)
    expect(new Set(WS_IDS).size).toBe(WS_IDS.length)
    expect(getWorkspaces().workspaces.some((w) => w.status === 'live')).toBe(true)
  })

  test('default workspace id refers to a listed workspace', () => {
    const { default: fallback } = getWorkspaces()
    expect(WS_IDS).toContain(fallback)
  })

  test('each workspace summary agrees with its health payload', () => {
    for (const w of getWorkspaces().workspaces) {
      const health = getHealth(w.id)
      expect(health.workspace).toBe(w.id)
      expect(health.crates).toBe(w.crates)
      expect(health.edges).toBe(w.edges)
      expect(health.toolchain).toBe(w.toolchain)
    }
  })
})

/* --------------------------------------------------------------- findings -- */

describe('doctor fixtures — finding invariants (Gate 11 / Gate 13 / Gate 21)', () => {
  for (const ws of WS_IDS) {
    test(`[${ws}] every finding has a stable unique ID and non-empty evidence`, () => {
      const { findings } = getDoctor(ws)
      expect(findings.length).toBeGreaterThan(0)

      const ids = findings.map((f) => f.id)
      for (const id of ids) {
        expect(id.length).toBeGreaterThan(0)
      }
      expect(new Set(ids).size).toBe(ids.length) // stable + unique

      for (const f of findings) {
        expect(f.evidence.length).toBeGreaterThan(0)
        for (const e of f.evidence) {
          expect(e.label.length).toBeGreaterThan(0)
          expect(e.value.length).toBeGreaterThan(0)
          expect(e.source.length).toBeGreaterThan(0) // source attribution
        }
        expect(f.recommendation.length).toBeGreaterThan(0)
        expect(f.verificationPath.length).toBeGreaterThan(0)
      }
    })

    test(`[${ws}] confidence, class, measurement status, severity, section and remediation stay in their enums`, () => {
      for (const f of getDoctor(ws).findings) {
        expect(f.confidence).toBeGreaterThanOrEqual(0)
        expect(f.confidence).toBeLessThanOrEqual(100)
        expect(Number.isFinite(f.confidence)).toBe(true)
        expect(CONFIDENCE_CLASSES).toContain(f.confidenceClass)
        expect(MEASUREMENT_STATUSES).toContain(f.measurementStatus)
        expect(SEVERITIES).toContain(f.severity)
        expect(SECTIONS).toContain(f.section)
        expect(REMEDIATION_KINDS).toContain(f.remediationKind)
        if (f.impactSeconds != null) {
          expect(Number.isFinite(f.impactSeconds)).toBe(true)
        }
      }
    })
  }
})

/* ------------------------------------------------------------------ graph -- */

describe('graph fixtures — structural integrity', () => {
  for (const ws of WS_IDS) {
    test(`[${ws}] edges reference known nodes; meta agrees with health/registry`, () => {
      const graph = getGraphPayload(ws)
      const health = getHealth(ws)
      const nodeIds = new Set(graph.nodes.map((n) => n.id))

      expect(graph.nodes.length).toBeGreaterThan(0)
      expect(graph.edges.length).toBeGreaterThan(0)
      for (const e of graph.edges) {
        expect(nodeIds.has(e.from)).toBe(true)
        expect(nodeIds.has(e.to)).toBe(true)
      }
      expect(graph.meta.workspaceCrates).toBe(health.crates)
      expect(graph.meta.totalEdges).toBe(health.edges)
      for (const d of graph.duplicates) {
        expect(d.versions.length).toBeGreaterThan(1) // a "duplicate" has ≥2 versions
        expect(d.wastedSeconds).toBeGreaterThanOrEqual(0)
      }
    })
  }
})

/**
 * ENG-TCA-3 reconciliation — the golden property the QA cross-check script
 * (Task 2-c-a) demanded: EVERY claimed number inside one /graph payload is
 * recomputable from the payload's own edge list. Nothing is hand-typed.
 */
describe('graph fixtures — derived aggregates reconcile with the served edges (ENG-TCA-3)', () => {
  for (const ws of WS_IDS) {
    test(`[${ws}] fanIn/fanOut/downstream/blast/duplicates/impact all recompute from edges`, () => {
      const graph = getGraphPayload(ws)
      const health = getHealth(ws)
      const nodes = graph.nodes
      const ids = new Set(nodes.map((n) => n.id))
      const kindOf = new Map(nodes.map((n) => [n.id, n.kind]))

      // degrees + reverse adjacency from the SERVED edges
      const inDeg = new Map<string, number>()
      const outDeg = new Map<string, number>()
      const dependents = new Map<string, string[]>()
      for (const n of nodes) {
        inDeg.set(n.id, 0)
        outDeg.set(n.id, 0)
        dependents.set(n.id, [])
      }
      for (const e of graph.edges) {
        inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
        outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1)
        dependents.get(e.to)?.push(e.from)
      }

      // transitive workspace-kind dependent closure (downstream / blast radius)
      const closure = (id: string): string[] => {
        const seen = new Set<string>([id])
        const queue = [...(dependents.get(id) ?? [])]
        while (queue.length > 0) {
          const cur = queue.shift() as string
          if (seen.has(cur)) continue
          seen.add(cur)
          for (const next of dependents.get(cur) ?? []) if (!seen.has(next)) queue.push(next)
        }
        seen.delete(id)
        return [...seen].filter((x) => kindOf.get(x) === 'workspace')
      }

      // 1. every node's fanIn/fanOut == served edge degrees
      for (const n of nodes) {
        expect(n.fanIn).toBe(inDeg.get(n.id))
        expect(n.fanOut).toBe(outDeg.get(n.id))
      }

      // 2. every node's downstream == its workspace closure, within workspace size
      for (const n of nodes) {
        expect(n.downstream).toBe(closure(n.id).length)
        expect(n.downstream).toBeLessThanOrEqual(graph.meta.workspaceCrates)
        expect(n.downstream).toBeGreaterThanOrEqual(0)
      }

      // 3. blast.affectedWorkspace == nodes[crate].downstream == closure; chain is a real path
      for (const b of graph.blast) {
        const node = nodes.find((n) => n.id === b.crate)
        expect(node).toBeDefined()
        expect(b.affectedWorkspace).toBe(node?.downstream)
        expect(b.affectedWorkspace).toBe(closure(b.crate).length)
        expect(b.affectedWorkspace).toBeGreaterThan(0)
        expect(b.chain[0]).toBe(b.crate)
        for (const step of b.chain) expect(ids.has(step)).toBe(true)
        for (let i = 0; i + 1 < b.chain.length; i += 1) {
          // chain walks DEPENDENTS: chain[i+1] depends on chain[i]
          expect(graph.edges.some((e) => e.from === b.chain[i + 1] && e.to === b.chain[i])).toBe(true)
        }
      }

      // 4. duplicate groups: name + every dependent resolve to nodes via served edges
      for (const d of graph.duplicates) {
        expect(ids.has(d.name)).toBe(true)
        expect(d.dependents.length).toBeGreaterThan(0)
        for (const label of d.dependents) {
          const head = label.replace(/ \([\w-]+\)$/, '')
          expect(ids.has(head)).toBe(true)
          expect(graph.edges.some((e) => e.from === head && e.to === d.name)).toBe(true)
        }
      }

      // 5. meta declares the subset relationship explicitly
      expect(graph.meta.scope).toBe('backbone-subset')
      expect(graph.meta.aggregateSource).toBe('served-edges')
      expect(graph.meta.servedNodes).toBe(nodes.length)
      expect(graph.meta.servedEdges).toBe(graph.edges.length)
      expect(graph.meta.workspaceCrates).toBe(health.crates)

      // 6. health.slowestCrates downstream agrees with the graph (no parallel truths)
      for (const s of health.slowestCrates) {
        const node = nodes.find((n) => n.id === s.name)
        expect(node).toBeDefined()
        expect(s.downstream).toBe(node?.downstream)
      }
    })

    test(`[${ws}] impact upgrade scenarios derive duplicateBefore + recompileCrates (ENG-TCA-3)`, () => {
      const graph = getGraphPayload(ws)
      const nodes = graph.nodes
      const kindOf = new Map(nodes.map((n) => [n.id, n.kind]))
      const dependents = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
      for (const e of graph.edges) dependents.get(e.to)?.push(e.from)
      const closureSize = (id: string): number => {
        const seen = new Set<string>([id])
        const queue = [...(dependents.get(id) ?? [])]
        while (queue.length > 0) {
          const cur = queue.shift() as string
          if (seen.has(cur)) continue
          seen.add(cur)
          for (const next of dependents.get(cur) ?? []) if (!seen.has(next)) queue.push(next)
        }
        seen.delete(id)
        return [...seen].filter((x) => kindOf.get(x) === 'workspace').length
      }

      for (const u of graph.catalog?.upgrades ?? []) {
        const r = getImpact('upgrade-dep', u.id, ws) as {
          duplicateBefore: boolean
          recompileCrates: number
        } | null
        expect(r).not.toBeNull()
        // duplicateBefore derives from the SAME payload's duplicates list
        expect(r?.duplicateBefore).toBe(graph.duplicates.some((d) => d.name === u.id))
        // recompileCrates derives from the served closure and respects workspace size
        expect(r?.recompileCrates).toBe(closureSize(u.id))
        expect(r?.recompileCrates).toBeLessThanOrEqual(graph.meta.workspaceCrates)
      }
    })
  }
})

/* --------------------------------------------------------------------- PR -- */

describe('PR analysis fixtures', () => {
  for (const ws of WS_IDS) {
    test(`[${ws}] regression guard payload is complete and finite`, () => {
      const pr = getPRAnalysis(ws)
      expect(Number.isFinite(pr.regressionPct)).toBe(true)
      expect(pr.affectedCrates).toBeGreaterThanOrEqual(0)
      expect(pr.before).toBeGreaterThan(0)
      expect(pr.after).toBeGreaterThan(0)
      expect(pr.causeChain.length).toBeGreaterThan(0)
      expect(CONFIDENCE_CLASSES).toContain(pr.confidenceClass)
    })
  }
})

/* ------------------------------------------------- measured vs estimated --- */

describe('Estimated / Measured / Verified are never conflated (Gate 21 / Gate 7)', () => {
  test('experiment claims follow their status: verified ⇒ measured result + improvement; draft ⇒ estimated', () => {
    const withRuns = WS_IDS.map((ws) => getExperiments(ws)).find(
      (p) => p.experiments.length > 0,
    )
    expect(withRuns).toBeDefined()

    for (const e of withRuns?.experiments ?? []) {
      if (e.status === 'verified') {
        expect(e.claim).toBe('verified') // a verified experiment may claim verified
        expect(e.improvementPct).not.toBeNull()
        expect(e.baseline).not.toBeNull()
        expect(e.candidate).not.toBeNull()
        for (const run of [e.baseline, e.candidate]) {
          expect(run?.runs).toBeGreaterThan(0)
          expect(Number.isFinite(run?.seconds ?? NaN)).toBe(true)
        }
      }
      if (e.status === 'draft') {
        expect(e.claim).toBe('estimated') // never claims measured/verified
        expect(e.baseline).toBeNull()
        expect(e.improvementPct).toBeNull()
      }
    }
  })

  test('report flavor preserves each finding measurement status verbatim', () => {
    const ws = WS_IDS[0]
    const report = buildWorkspaceJsonReport(ws, FROZEN_NOW)
    const doctor = getDoctor(ws)
    for (const f of report.json.doctor.findings) {
      const source = doctor.findings.find((x) => x.id === f.id)
      expect(source).toBeDefined()
      if (!source) throw new Error(`report finding ${f.id} has no doctor-fixture source`)
      expect(f.measurementStatus).toBe(source.measurementStatus)
      expect(f.confidencePct).toBe(source.confidence)
      expect(MEASUREMENT_STATUSES as readonly string[]).toContain(f.measurementStatus)
    }
  })
})

/* ------------------------------------------------------- estimated range --- */

describe('estimatedRange semantics survive the machine flavors (ENG-TCA-5)', () => {
  test('json flavor carries structured estimatedAfterFix — not a CI around buildTime', () => {
    for (const ws of WS_IDS) {
      const doctor = getDoctor(ws)
      const { json } = buildWorkspaceJsonReport(ws, FROZEN_NOW)

      // the ambiguous flat tuple is gone
      expect((json.doctor as Record<string, unknown>)['estimatedRangeSeconds']).toBeUndefined()

      const est = json.doctor.estimatedAfterFix
      expect(est.unit).toBe('seconds')
      expect(est.status).toBe('estimated')
      expect(est.meaning).toBe('projected-after-top-fix')
      expect(est.estimatedRange.low).toBe(doctor.estimatedRange[0])
      expect(est.estimatedRange.high).toBe(doctor.estimatedRange[1])
      expect(est.estimatedRange.high).toBeGreaterThanOrEqual(est.estimatedRange.low)
      expect(est.confidencePct).toBe(doctor.confidence)
      expect(est.note.toLowerCase()).toContain('not a confidence interval')

      // structured current-build value travels with an explicit unit
      expect(json.doctor.buildTime).toEqual({ value: doctor.buildTime, unit: 'seconds' })
      expect(json.doctor.buildTimeSeconds).toBe(doctor.buildTime)

      // the projection may legitimately sit OUTSIDE the measured build time —
      // the payload documents that relationship explicitly instead of leaving
      // consumers to misread the range as an interval
      const outside = doctor.buildTime < est.estimatedRange.low || doctor.buildTime > est.estimatedRange.high
      if (outside) expect(est.note.toLowerCase()).toContain('may legitimately fall outside')
    }
  })

  test('markdown flavor says "estimated after top fix" — human wording kept', () => {
    for (const ws of WS_IDS) {
      const doctor = getDoctor(ws)
      const { markdown } = buildWorkspaceReport(ws, FROZEN_NOW)
      expect(markdown).toContain(
        `(estimated after top fix: ${doctor.estimatedRange[0].toFixed(1)}–${doctor.estimatedRange[1].toFixed(1)}s · confidence ${doctor.confidence}%)`,
      )
      expect(markdown).not.toContain('estimated range')
    }
  })

  test('markdown envelope carries the wanyrix.markdown/v1 schema marker (ENG-TCA-6d)', () => {
    const bundle = buildWorkspaceReport(WS_IDS[0], FROZEN_NOW)
    expect(bundle.schema).toBe('wanyrix.markdown/v1')
  })
})

/* ------------------------------------------------------------ json report -- */

describe('buildWorkspaceJsonReport — versioned flavor (wanyrix.report/v1)', () => {
  test('carries the schema version, workspace echo and dated filename', () => {
    const ws = WS_IDS[0]
    const bundle = buildWorkspaceJsonReport(ws, FROZEN_NOW)

    expect(bundle.json.schema).toBe('wanyrix.report/v1')
    expect(bundle.json.workspace).toBe(ws)
    expect(bundle.json.generatedAt).toBe(FROZEN_NOW.toISOString())
    expect(bundle.filename).toBe(`wanyrix-report-${ws}-2026-09-18.json`)
    expect(bundle.bytes).toBe(byteLength(JSON.stringify(bundle.json)))
  })

  test('is deterministic — same input produces a deep-equal report', () => {
    const ws = WS_IDS[0]
    const a = buildWorkspaceJsonReport(ws, FROZEN_NOW)
    const b = buildWorkspaceJsonReport(ws, FROZEN_NOW)
    expect(JSON.stringify(a.json)).toBe(JSON.stringify(b.json))
    expect(a.bytes).toBe(b.bytes)
  })

  test('findings are sorted by severity (critical first) and blast top ≤ 5 descending', () => {
    const ws = WS_IDS[0]
    const { json } = buildWorkspaceJsonReport(ws, FROZEN_NOW)

    const rank = (s: string) => (s === 'critical' ? 0 : 4)
    const ranks = json.doctor.findings.map((f) => rank(f.severity))
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1])
    }

    expect(json.graph.blastTop.length).toBeLessThanOrEqual(5)
    for (let i = 1; i < json.graph.blastTop.length; i += 1) {
      expect(json.graph.blastTop[i].affectedWorkspace).toBeLessThanOrEqual(
        json.graph.blastTop[i - 1].affectedWorkspace,
      )
    }
  })

  test('honesty notes and storage accounting are present and consistent', () => {
    const ws = WS_IDS[0]
    const { json } = buildWorkspaceJsonReport(ws, FROZEN_NOW)

    expect(json.honestyNotes.length).toBeGreaterThan(0)
    expect(json.honestyNotes.some((n) => n.includes('Gate 21'))).toBe(true)
    expect(json.storage.rows.length).toBeGreaterThan(0)
    const rowSum = json.storage.rows.reduce((acc, r) => acc + r.sizeMB, 0)
    expect(Math.abs(json.storage.totalMB - rowSum)).toBeLessThan(0.05) // 1dp rounding
    expect(json.storage.totalMB).toBeGreaterThan(0)
    expect(json.storage.note.toLowerCase()).toContain('simulated')
    // Every summary number traces back to the health payload (no parallel truths).
    const health = getHealth(ws)
    expect(json.summary.crates).toBe(health.crates)
    expect(json.summary.edges).toBe(health.edges)
    expect(json.summary.toolchain).toBe(health.toolchain)
    expect(json.summary.cacheHitRate).toBe(health.cacheHitRate)
  })
})

/* ------------------------------------------------------- markdown report --- */

describe('buildWorkspaceReport — markdown flavor', () => {
  test('renders the workspace header, scorecard verdict and honesty footer', () => {
    const ws = WS_IDS[0]
    const bundle = buildWorkspaceReport(ws, FROZEN_NOW)

    expect(bundle.markdown.startsWith(`# Wanyrix workspace report — ${ws}`)).toBe(true)
    expect(bundle.filename).toBe(`wanyrix-report-${ws}-2026-09-18.md`)
    expect(bundle.bytes).toBe(byteLength(bundle.markdown))
    expect(bundle.markdown).toContain('## Build intelligence — wanyrix doctor')
    expect(bundle.markdown).toContain('## Release scorecard')
    expect(bundle.markdown).toContain('## Storage (simulated telemetry)')
    expect(bundle.markdown).toContain('_Honesty notes:_')
  })

  test('is deterministic — same input produces an identical document', () => {
    const ws = WS_IDS[0]
    expect(buildWorkspaceReport(ws, FROZEN_NOW).markdown).toBe(
      buildWorkspaceReport(ws, FROZEN_NOW).markdown,
    )
  })

  test('cross-flavor: every doctor finding ID appears in the markdown', () => {
    const ws = WS_IDS[0]
    const { markdown } = buildWorkspaceReport(ws, FROZEN_NOW)
    for (const f of getDoctor(ws).findings) {
      expect(markdown).toContain(f.id)
    }
  })
})
