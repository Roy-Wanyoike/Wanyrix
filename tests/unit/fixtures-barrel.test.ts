/**
 * Task 7-b (GitHub issue #53) — data.ts decomposition + fixture generator.
 *
 * Pins three contracts:
 *  1. data.ts is a PURE re-export barrel (<40 lines, no statements besides
 *     re-exports) so every existing `@/lib/wanyrix/data` import keeps working
 *     unchanged;
 *  2. every export of the barrel is the SAME binding (reference identity) as
 *     the domain module export under src/lib/wanyrix/fixtures/;
 *  3. the fixture generator (scripts/fixture-gen.ts) emits deterministic,
 *     honestly-marked SYNTHETIC fixtures whose graph aggregates are derivable
 *     from the emitted edges and whose severity/section counts match the
 *     findings array.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as data from '../../src/lib/wanyrix/data'
import * as blast from '../../src/lib/wanyrix/fixtures/blast'
import * as catalog from '../../src/lib/wanyrix/fixtures/catalog'
import * as diagnostics from '../../src/lib/wanyrix/fixtures/diagnostics'
import * as doctor from '../../src/lib/wanyrix/fixtures/doctor'
import * as duplicates from '../../src/lib/wanyrix/fixtures/duplicates'
import * as experiments from '../../src/lib/wanyrix/fixtures/experiments'
import * as findings from '../../src/lib/wanyrix/fixtures/findings'
import * as gates from '../../src/lib/wanyrix/fixtures/gates'
import * as graph from '../../src/lib/wanyrix/fixtures/graph'
import * as health from '../../src/lib/wanyrix/fixtures/health'
import * as issues from '../../src/lib/wanyrix/fixtures/issues'
import * as organization from '../../src/lib/wanyrix/fixtures/organization'
import * as pr from '../../src/lib/wanyrix/fixtures/pr'
import * as selectors from '../../src/lib/wanyrix/fixtures/selectors'
import * as shared from '../../src/lib/wanyrix/fixtures/shared'
import * as simulator from '../../src/lib/wanyrix/fixtures/simulator'
import * as workspaces from '../../src/lib/wanyrix/fixtures/workspaces'
import type { DerivedGraphMath } from '../../src/lib/wanyrix/fixtures/graph'
import type { DerivedGraphMath as DerivedGraphMathViaBarrel } from '../../src/lib/wanyrix/data'

/* ------------------------------------------------- barrel-shape checks --- */

const BARREL_PATH = join(import.meta.dir, '..', '..', 'src', 'lib', 'wanyrix', 'data.ts')

/** The full runtime export surface the old 3,006-line data.ts had — unchanged. */
const EXPECTED_RUNTIME_EXPORTS = [
  'ADD_DEP_CATALOG',
  'BLAST',
  'BLAST_ATLAS',
  'DIAGNOSTICS',
  'DIAGNOSTICS_ATLAS',
  'DOCTOR',
  'DOCTOR_ATLAS',
  'EXPERIMENTS',
  'FINDINGS',
  'GATES',
  'GRAPH_EDGES',
  'GRAPH_EDGES_ATLAS',
  'GRAPH_NODES',
  'GRAPH_NODES_ATLAS',
  'HEALTH',
  'HEALTH_ATLAS',
  'ISSUES',
  'ORGANIZATION',
  'PR_184',
  'PR_97_ATLAS',
  'REPO_URL',
  'SPLIT_SIM',
  'WORKSPACE',
  'WORKSPACE_ATLAS',
  'WORKSPACES',
  'WORKSPACES_DEFAULT',
  'DUPLICATES',
  'DUPLICATES_ATLAS',
  'getDiagnostics',
  'getDoctor',
  'getExperiments',
  'getGraphPayload',
  'getHealth',
  'getImpact',
  'getPRAnalysis',
  'getWorkspaces',
].sort()

describe('data.ts is a pure re-export barrel (issue #53)', () => {
  test('file is <40 lines and contains only re-exports', () => {
    const src = readFileSync(BARREL_PATH, 'utf8')
    const lineCount = src.trimEnd().split('\n').length
    expect(lineCount).toBeLessThan(40)

    // strip the header comment, then every remaining non-blank line must be
    // part of an `export ... from './fixtures/…'` statement — nothing else.
    const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '')
    const statements = withoutComments
      .split(/(?=export )/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    expect(statements.length).toBeGreaterThan(0)
    for (const s of statements) {
      expect(s.startsWith('export ')).toBe(true)
      expect(s).toMatch(/from '\.\/fixtures\/[a-z]+'/)
    }
    expect(withoutComments).not.toMatch(/\b(import|const|let|var|function|class)\b/)
  })

  test('runtime export surface is exactly the legacy one (names unchanged)', () => {
    expect(Object.keys(data).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS)
  })

  test('DerivedGraphMath type is re-exported through the barrel (type identity)', () => {
    // compile-time identity: both imports must be mutually assignable (tsc gate)
    const viaGraph: DerivedGraphMath = graph.HELIOS_MATH
    const viaBarrel: DerivedGraphMathViaBarrel = viaGraph
    expect(viaBarrel.fanIn).toBe(graph.HELIOS_MATH.fanIn)
  })
})

/* ------------------------------------------------ barrel↔module parity --- */

describe('barrel re-exports equal the domain-module exports', () => {
  test('shared', () => {
    expect(data.REPO_URL).toBe(shared.REPO_URL)
  })

  test('workspaces', () => {
    expect(data.WORKSPACE).toBe(workspaces.WORKSPACE)
    expect(data.WORKSPACE_ATLAS).toBe(workspaces.WORKSPACE_ATLAS)
    expect(data.WORKSPACES).toBe(workspaces.WORKSPACES)
    expect(data.WORKSPACES_DEFAULT).toBe(workspaces.WORKSPACES_DEFAULT)
  })

  test('findings', () => {
    expect(data.FINDINGS).toBe(findings.FINDINGS)
    // ATLAS_FINDINGS stays an internal cross-module export (not on the barrel)
    expect('ATLAS_FINDINGS' in data).toBe(false)
    expect(findings.ATLAS_FINDINGS.length).toBeGreaterThan(0)
  })

  test('doctor', () => {
    expect(data.DOCTOR).toBe(doctor.DOCTOR)
    expect(data.DOCTOR_ATLAS).toBe(doctor.DOCTOR_ATLAS)
    expect(data.DOCTOR.findings).toBe(findings.FINDINGS)
    expect(data.DOCTOR_ATLAS.findings).toBe(findings.ATLAS_FINDINGS)
  })

  test('health', () => {
    expect(data.HEALTH).toBe(health.HEALTH)
    expect(data.HEALTH_ATLAS).toBe(health.HEALTH_ATLAS)
  })

  test('graph', () => {
    expect(data.GRAPH_EDGES).toBe(graph.GRAPH_EDGES)
    expect(data.GRAPH_NODES).toBe(graph.GRAPH_NODES)
    expect(data.GRAPH_EDGES_ATLAS).toBe(graph.GRAPH_EDGES_ATLAS)
    expect(data.GRAPH_NODES_ATLAS).toBe(graph.GRAPH_NODES_ATLAS)
  })

  test('duplicates', () => {
    expect(data.DUPLICATES).toBe(duplicates.DUPLICATES)
    expect(data.DUPLICATES_ATLAS).toBe(duplicates.DUPLICATES_ATLAS)
  })

  test('blast', () => {
    expect(data.BLAST).toBe(blast.BLAST)
    expect(data.BLAST_ATLAS).toBe(blast.BLAST_ATLAS)
  })

  test('catalog', () => {
    expect(data.ADD_DEP_CATALOG).toBe(catalog.ADD_DEP_CATALOG)
    // atlas/upgrade catalogs stay internal to fixtures (not on the barrel)
    expect('ATLAS_ADD_DEP_CATALOG' in data).toBe(false)
    expect('UPGRADE_CATALOG' in data).toBe(false)
    expect('ATLAS_UPGRADE_CATALOG' in data).toBe(false)
  })

  test('simulator', () => {
    expect(data.SPLIT_SIM).toBe(simulator.SPLIT_SIM)
    expect('SPLIT_SIM_ATLAS' in data).toBe(false)
  })

  test('diagnostics', () => {
    expect(data.DIAGNOSTICS).toBe(diagnostics.DIAGNOSTICS)
    expect(data.DIAGNOSTICS_ATLAS).toBe(diagnostics.DIAGNOSTICS_ATLAS)
  })

  test('pr', () => {
    expect(data.PR_184).toBe(pr.PR_184)
    expect(data.PR_97_ATLAS).toBe(pr.PR_97_ATLAS)
  })

  test('experiments', () => {
    expect(data.EXPERIMENTS).toBe(experiments.EXPERIMENTS)
  })

  test('gates', () => {
    expect(data.GATES).toBe(gates.GATES)
  })

  test('issues', () => {
    expect(data.ISSUES).toBe(issues.ISSUES)
    expect(data.ISSUES.every((i) => i.repoUrl === data.REPO_URL)).toBe(true)
  })

  test('organization', () => {
    expect(data.ORGANIZATION).toBe(organization.ORGANIZATION)
  })

  test('selectors', () => {
    expect(data.getWorkspaces).toBe(selectors.getWorkspaces)
    expect(data.getHealth).toBe(selectors.getHealth)
    expect(data.getDoctor).toBe(selectors.getDoctor)
    expect(data.getDiagnostics).toBe(selectors.getDiagnostics)
    expect(data.getPRAnalysis).toBe(selectors.getPRAnalysis)
    expect(data.getGraphPayload).toBe(selectors.getGraphPayload)
    expect(data.getImpact).toBe(selectors.getImpact)
    expect(data.getExperiments).toBe(selectors.getExperiments)
    // behavioral parity through both import paths (same payload, deep-equal)
    expect(data.getGraphPayload('helios-platform')).toEqual(selectors.getGraphPayload('helios-platform'))
    expect(data.getGraphPayload('atlas-consortium')).toEqual(selectors.getGraphPayload('atlas-consortium'))
  })
})

/* ---------------------------------------------------- fixture generator --- */

interface GenNode {
  id: string
  kind: 'workspace' | 'external' | 'proc-macro'
  fanIn: number
  fanOut: number
  downstream: number
  versions?: string[]
  duplicate?: boolean
}

interface GenFinding {
  id: string
  section: string
  severity: 'critical' | 'warning' | 'info'
  affected: string[]
}

interface Envelope {
  synthetic: boolean
  generator: string
  seed: number
}

function runGen(args: string[]): { exitCode: number; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fixture-gen-test-'))
  const proc = Bun.spawnSync({
    cmd: ['bun', join(import.meta.dir, '..', '..', 'scripts', 'fixture-gen.ts'), ...args, '--out', dir],
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { exitCode: proc.exitCode ?? -1, dir }
}

function readJson(dir: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>
}

describe('fixture generator (scripts/fixture-gen.ts)', () => {
  const run = runGen(['--crates', '20', '--seed', '7'])

  test('generates the three JSON fixtures for seed 7 / 20 crates (exit 0)', () => {
    expect(run.exitCode).toBe(0)
    for (const f of ['findings.json', 'graph.json', 'doctor.json']) {
      expect(existsSync(join(run.dir, f))).toBe(true)
    }
  })

  test('every emitted JSON is honestly marked SYNTHETIC with generator + seed', () => {
    for (const f of ['findings.json', 'graph.json', 'doctor.json']) {
      const j = readJson(run.dir, f) as unknown as Envelope
      expect(j.synthetic).toBe(true)
      expect(j.generator).toBe('fixture-gen v1')
      expect(j.seed).toBe(7)
    }
  })

  test('graph consistency: unique nodes, edges reference existing nodes, DAG', () => {
    const g = readJson(run.dir, 'graph.json')
    const nodes = g.nodes as GenNode[]
    const edges = g.edges as { from: string; to: string }[]
    const ids = new Set(nodes.map((n) => n.id))
    expect(ids.size).toBe(nodes.length)
    for (const e of edges) {
      expect(ids.has(e.from)).toBe(true)
      expect(ids.has(e.to)).toBe(true)
      expect(e.from).not.toBe(e.to)
    }
    // acyclicity via Kahn
    const indeg = new Map([...ids].map((id) => [id, 0]))
    for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
    const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
    let visited = 0
    while (queue.length > 0) {
      const cur = queue.shift() as string
      visited++
      for (const e of edges.filter((x) => x.from === cur)) {
        const d = (indeg.get(e.to) ?? 0) - 1
        indeg.set(e.to, d)
        if (d === 0) queue.push(e.to)
      }
    }
    expect(visited).toBe(ids.size)
  })

  test('graph aggregates are derivable from the emitted edges (recomputed here)', () => {
    const g = readJson(run.dir, 'graph.json')
    const nodes = g.nodes as GenNode[]
    const edges = g.edges as { from: string; to: string }[]
    const fanIn: Record<string, number> = {}
    const fanOut: Record<string, number> = {}
    for (const n of nodes) {
      fanIn[n.id] = 0
      fanOut[n.id] = 0
    }
    for (const e of edges) {
      fanIn[e.to]++
      fanOut[e.from]++
    }
    // downstream: workspace-kind crates that transitively depend on the node
    const dependents: Record<string, string[]> = {}
    for (const n of nodes) dependents[n.id] = []
    for (const e of edges) dependents[e.to].push(e.from)
    for (const n of nodes) {
      const seen = new Set<string>([n.id])
      const q = [...dependents[n.id]]
      while (q.length > 0) {
        const cur = q.shift() as string
        if (seen.has(cur)) continue
        seen.add(cur)
        for (const next of dependents[cur]) if (!seen.has(next)) q.push(next)
      }
      seen.delete(n.id)
      const workspaceDownstream = nodes
        .filter((m) => m.kind === 'workspace' && seen.has(m.id))
        .map((m) => m.id).length
      expect(n.fanIn).toBe(fanIn[n.id])
      expect(n.fanOut).toBe(fanOut[n.id])
      expect(n.downstream).toBe(workspaceDownstream)
    }
  })

  test('findings reference real crates; severity/section counts match the arrays', () => {
    const f = readJson(run.dir, 'findings.json')
    const d = readJson(run.dir, 'doctor.json')
    const g = readJson(run.dir, 'graph.json')
    const findingsArr = f.findings as GenFinding[]
    const nodeIds = new Set((g.nodes as GenNode[]).map((n) => n.id))
    expect(findingsArr.length).toBeGreaterThan(0)
    for (const finding of findingsArr) {
      for (const a of finding.affected) {
        expect(nodeIds.has(a)).toBe(true)
      }
    }
    const severityCounts = d.severityCounts as Record<string, number>
    const actual: Record<string, number> = { critical: 0, warning: 0, info: 0 }
    for (const x of findingsArr) actual[x.severity]++
    expect(severityCounts).toEqual(actual)
    const findingCounts = d.findingCounts as { section: string; count: number }[]
    const sections = new Set(findingsArr.map((x) => x.section))
    expect(findingCounts.length).toBe(sections.size)
    for (const s of findingCounts) {
      expect(s.count).toBe(findingsArr.filter((x) => x.section === s.section).length)
    }
  })

  test('duplicate groups reference duplicate-flagged nodes with the same versions', () => {
    const g = readJson(run.dir, 'graph.json')
    const nodes = g.nodes as GenNode[]
    const dups = g.duplicates as { name: string; versions: string[] }[]
    expect(dups.length).toBeGreaterThan(0)
    for (const d of dups) {
      const node = nodes.find((n) => n.id === d.name)
      expect(node).toBeDefined()
      expect(node?.duplicate).toBe(true)
      expect(node?.versions).toEqual(d.versions)
    }
  })

  test('deterministic: same seed → byte-identical output files', () => {
    const second = runGen(['--crates', '20', '--seed', '7'])
    expect(second.exitCode).toBe(0)
    for (const f of ['findings.json', 'graph.json', 'doctor.json']) {
      expect(readFileSync(join(run.dir, f), 'utf8')).toBe(readFileSync(join(second.dir, f), 'utf8'))
    }
    rmSync(second.dir, { recursive: true, force: true })
  })

  test('different seed → different fixture (seed actually drives the output)', () => {
    const other = runGen(['--crates', '20', '--seed', '8'])
    expect(other.exitCode).toBe(0)
    expect(readFileSync(join(run.dir, 'graph.json'), 'utf8')).not.toBe(
      readFileSync(join(other.dir, 'graph.json'), 'utf8'),
    )
    rmSync(other.dir, { recursive: true, force: true })
  })

  test('usage errors exit 2 and write nothing', () => {
    const bad = runGen(['--crates', '3'])
    expect(bad.exitCode).toBe(2)
    expect(existsSync(join(bad.dir, 'graph.json'))).toBe(false)
    const badArg = runGen(['--frobnicate'])
    expect(badArg.exitCode).toBe(2)
    rmSync(bad.dir, { recursive: true, force: true })
    rmSync(badArg.dir, { recursive: true, force: true })
  })

  test('cleanup: remove the primary temp fixture dir', () => {
    rmSync(run.dir, { recursive: true, force: true })
    expect(existsSync(run.dir)).toBe(false)
  })
})
