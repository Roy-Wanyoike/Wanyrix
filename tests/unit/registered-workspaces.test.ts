/**
 * QA-5-B-1 — registered local projects are first-class workspaces.
 *
 * The connect-a-project bridge measured the user's project and stored it
 * server-side, but the shell read only `data.workspaces` (fixtures) — the
 * registered row was invisible in the selector, palette and Repositories,
 * and /doctor · /graph · /health · /pr 404'd it. These tests pin the fix:
 *
 *   1. `mergeWorkspaceRegistry` — the ONE merge point for selector, palette
 *      and Repositories: registered rows FIRST, fixtureOnly preserved.
 *   2. the payload adapters — engine envelopes → web payloads with findings
 *      VERBATIM and absent telemetry honestly zero/empty + labeled.
 *   3. source pins — every surface consumes the merge; the routes dispatch
 *      registered ids to the real-engine branch; the doctor view labels the
 *      not-measured telemetry.
 *
 * The adapters are exercised with engine-shaped envelopes captured from the
 * REAL binary's documented output (wanyrix doctor|graph --json) — no spawn,
 * no db, no server required.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isRegisteredWorkspaceId } from '../../src/lib/wanyrix/register'
import {
  mergeWorkspaceRegistry,
  registeredToSummary,
  type WorkspaceRegistryInput,
} from '../../src/lib/wanyrix/registered-workspace'
import {
  doctorReportFromEngine,
  graphPayloadFromEngine,
  healthPayloadFromEngine,
  type EngineDoctorEnvelope,
  type EngineGraphEnvelope,
} from '../../src/lib/wanyrix/registered-adapters'
import type { RegisteredWorkspaceSummary } from '../../src/lib/wanyrix/types'

const ROOT = join(import.meta.dir, '..', '..')

/* ------------------------------------------------------------ fixtures --- */

const ROW: RegisteredWorkspaceSummary = {
  id: 'ws-local-pm-demo-ws-8b5e183a',
  name: 'pm-demo-ws',
  path: '/tmp/pm-demo-ws',
  registeredAt: '2026-09-22T19:59:24.006Z',
  lastCheckedAt: '2026-09-22T20:01:07.856Z',
  lastStatus: 'ok',
  crates: 2,
  edges: 1,
  findings: 5,
  critical: 0,
  warning: 5,
  info: 0,
  toolchain: 'unspecified (no rust-toolchain.toml)',
  fixtureOnly: false,
}

/** Engine-shaped doctor envelope (fields the REAL `wanyrix doctor --json` emits). */
const ENGINE_DOCTOR: EngineDoctorEnvelope = {
  schema: 'wanyrix.doctor/v1',
  workspace: 'pm-demo-ws',
  profile: 'manifest-static-v1',
  toolchain: 'unspecified (no rust-toolchain.toml)',
  generatedAt: '2026-09-22T20:26:04.900Z',
  summary: { critical: 0, warning: 5, info: 0, total: 5 },
  findings: [
    {
      id: 'FER-ENG-001-pm-cli',
      section: 'Workspace',
      severity: 'warning',
      title: 'Missing license field (crate `pm-cli`)',
      description: 'The manifest of crate `pm-cli` declares no license key.',
      evidence: [{ label: 'manifest', value: 'crates/pm-cli/Cargo.toml', source: 'filesystem — parsed Cargo.toml (measured)' }],
      affected: ['pm-cli'],
      impact: 'Publishing to crates.io is blocked.',
      recommendation: 'Add `license = "<SPDX>"` to the [package] table.',
      remediationKind: 'config',
      verificationPath: 'Re-run `wanyrix doctor --path <root> --json`.',
      confidenceClass: 'deterministic',
      confidence: 100,
      detection: 'wanyrix doctor rule FER-ENG-001',
      measurementStatus: 'measured',
    },
  ],
}

/** Engine-shaped graph envelope (fields the REAL `wanyrix graph --json` emits). */
const ENGINE_GRAPH: EngineGraphEnvelope = {
  schema: 'wanyrix.graph/v1',
  workspace: 'pm-demo-ws',
  generatedAt: '2026-09-22T20:29:18Z',
  nodes: [
    { id: 'pm-cli', band: 'bin', kind: 'workspace', buildTime: 0, fanIn: 0, fanOut: 1, downstream: 0, changeFreq: 0 },
    { id: 'pm-core', band: 'lib', kind: 'workspace', buildTime: 0, fanIn: 1, fanOut: 0, downstream: 1, changeFreq: 0 },
  ],
  edges: [{ from: 'pm-cli', to: 'pm-core' }],
  meta: {
    workspaceCrates: 2,
    totalEdges: 1,
    lastScan: '2026-09-22T20:29:18Z',
    scope: 'full-manifest-graph',
    servedNodes: 2,
    servedEdges: 1,
    aggregateSource: 'served-edges',
    note: 'Every node is a measured crate from the scanned manifests.',
  },
}

/* --------------------------------------------------- 1. registry merge --- */

describe('mergeWorkspaceRegistry — registered projects are first-class (QA-5-B-1)', () => {
  const payload: WorkspaceRegistryInput = {
    workspaces: [
      { id: 'helios-platform', name: 'helios-platform', description: 'demo', crates: 47, edges: 212, toolchain: 'rustc', accent: 'primary', status: 'live', findings: 12, lastScan: '2026-09-17T09:12:04Z', fixtureOnly: true },
      { id: 'atlas-consortium', name: 'atlas-consortium', description: 'demo', crates: 23, edges: 96, toolchain: 'rustc', accent: 'emerald', status: 'live', findings: 7, lastScan: '2026-09-17T08:41:37Z', fixtureOnly: true },
    ],
    registered: [ROW],
  }

  test('registered rows come FIRST, fixtures after', () => {
    const merged = mergeWorkspaceRegistry(payload)
    expect(merged.map((w) => w.id)).toEqual([
      'ws-local-pm-demo-ws-8b5e183a',
      'helios-platform',
      'atlas-consortium',
    ])
  })

  test('fixtureOnly is preserved verbatim — fixtures true, registered false', () => {
    const merged = mergeWorkspaceRegistry(payload)
    expect(merged.find((w) => w.id === 'helios-platform')?.fixtureOnly).toBe(true)
    expect(merged.find((w) => w.id === 'ws-local-pm-demo-ws-8b5e183a')?.fixtureOnly).toBe(false)
  })

  test('registered mapping invents nothing: measured counts, path description, real lastCheckedAt', () => {
    const ws = registeredToSummary(ROW)
    expect(ws.crates).toBe(2)
    expect(ws.edges).toBe(1)
    expect(ws.findings).toBe(5)
    expect(ws.toolchain).toBe('unspecified (no rust-toolchain.toml)')
    expect(ws.description).toContain('/tmp/pm-demo-ws')
    expect(ws.lastScan).toBe('2026-09-22T20:01:07.856Z')
    expect(ws.accent).toBe('zinc')
    expect(ws.status).toBe('live')
    expect(ws.fixtureOnly).toBe(false)
  })

  test('absent/undefined payload (loading state) merges to an empty list', () => {
    expect(mergeWorkspaceRegistry(undefined)).toEqual([])
    expect(mergeWorkspaceRegistry(null)).toEqual([])
    expect(mergeWorkspaceRegistry({ workspaces: [], registered: [] })).toEqual([])
  })

  test('pre-bridge payloads without `registered` still serve the fixtures', () => {
    const merged = mergeWorkspaceRegistry({ workspaces: payload.workspaces })
    expect(merged.map((w) => w.id)).toEqual(['helios-platform', 'atlas-consortium'])
  })
})

describe('isRegisteredWorkspaceId — cheap route pre-filter', () => {
  test('bridge ids carry the ws-local- prefix', () => {
    expect(isRegisteredWorkspaceId('ws-local-pm-demo-ws-8b5e183a')).toBe(true)
    expect(isRegisteredWorkspaceId('ws-local-wanyrix-engine-597292fe')).toBe(true)
  })
  test('fixture ids and garbage do not', () => {
    expect(isRegisteredWorkspaceId('helios-platform')).toBe(false)
    expect(isRegisteredWorkspaceId('atlas-consortium')).toBe(false)
    expect(isRegisteredWorkspaceId('does-not-exist-129')).toBe(false)
    expect(isRegisteredWorkspaceId('')).toBe(false)
  })
})

/* ------------------------------------------------------ 2. the adapters --- */

describe('doctorReportFromEngine — findings verbatim, telemetry honestly absent', () => {
  const report = doctorReportFromEngine(ENGINE_DOCTOR)

  test('findings pass through VERBATIM (the engine finding shape IS the web shape)', () => {
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.id).toBe('FER-ENG-001-pm-cli')
    expect(report.findings[0]?.measurementStatus).toBe('measured')
    expect(report.findings[0]?.evidence).toHaveLength(1)
  })

  test('no build telemetry is invented — zeros + the not-measured marker', () => {
    expect(report.buildTime).toBe(0)
    expect(report.estimatedRange).toEqual([0, 0])
    expect(report.confidence).toBe(0)
    expect(report.criticalPath).toEqual([])
    expect(report.phases).toEqual([])
    expect(report.buildTelemetry).toBe('not-measured')
    expect(report.summary.developerBuild).toContain('not measured')
  })

  test('identity fields come from the engine envelope', () => {
    expect(report.workspace).toBe('pm-demo-ws')
    expect(report.profile).toBe('manifest-static-v1')
    expect(report.scannedAt).toBe('2026-09-22T20:26:04.900Z')
  })
})

describe('graphPayloadFromEngine — the REAL full-manifest graph', () => {
  const payload = graphPayloadFromEngine(ENGINE_GRAPH)

  test('nodes/edges served as measured (2 crates · 1 edge for the 2-crate project)', () => {
    expect(payload.nodes).toHaveLength(2)
    expect(payload.edges).toHaveLength(1)
    expect(payload.meta.workspaceCrates).toBe(2)
    expect(payload.meta.totalEdges).toBe(1)
    expect(payload.meta.servedNodes).toBe(2)
    expect(payload.meta.servedEdges).toBe(1)
  })

  test('scope is full-manifest-graph + provenance marked; no fabricated duplicates/blast', () => {
    expect(payload.meta.scope).toBe('full-manifest-graph')
    expect(payload.meta.provenance).toBe('registered-local-project')
    expect(payload.duplicates).toEqual([])
    expect(payload.blast).toEqual([])
    expect(payload.catalog).toBeUndefined()
  })
})

describe('healthPayloadFromEngine — measured totals, honest empties', () => {
  const payload = healthPayloadFromEngine(
    doctorReportFromEngine(ENGINE_DOCTOR),
    graphPayloadFromEngine(ENGINE_GRAPH),
  )

  test('totals are the measured ones', () => {
    expect(payload.workspace).toBe('pm-demo-ws')
    expect(payload.crates).toBe(2)
    expect(payload.edges).toBe(1)
  })

  test('finding counts derive from the REAL findings (section-measured)', () => {
    expect(payload.findingCounts).toEqual([{ section: 'Workspace', count: 1 }])
  })

  test('telemetry the engine does not measure is empty + the payload says so', () => {
    expect(payload.buildTrend).toEqual([])
    expect(payload.slowestCrates).toEqual([])
    expect(payload.activity).toEqual([])
    expect(payload.cacheHitRate).toBe(0)
    expect(payload.provenance).toBe('registered-local-project')
    expect(payload.insight?.text).toContain('REAL engine measurements')
  })
})

/* ---------------------------------------------------- 3. source pins ----- */

describe('the merged registry is consumed by every registry surface (source pins)', () => {
  const shell = readFileSync(join(ROOT, 'src/components/wanyrix/app-shell.tsx'), 'utf8')
  const palette = readFileSync(join(ROOT, 'src/components/wanyrix/command-palette.tsx'), 'utf8')
  const repositories = readFileSync(
    join(ROOT, 'src/components/wanyrix/views/repositories-view.tsx'),
    'utf8',
  )
  const overview = readFileSync(
    join(ROOT, 'src/components/wanyrix/views/overview-view.tsx'),
    'utf8',
  )
  const dialog = readFileSync(join(ROOT, 'src/components/wanyrix/connect-project-dialog.tsx'), 'utf8')

  test('app-shell selector merges registered + fixtures (the old dead end)', () => {
    expect(shell).toContain('mergeWorkspaceRegistry')
    expect(shell).not.toContain('workspacesQuery.data?.workspaces ?? []')
  })

  test('⌘K palette merges registered + fixtures', () => {
    expect(palette).toContain('mergeWorkspaceRegistry')
  })

  test('Repositories merges registered + fixtures', () => {
    expect(repositories).toContain('mergeWorkspaceRegistry')
  })

  test('the connect dialog activates the new workspace (journey completes)', () => {
    expect(dialog).toContain('setActive(res.workspace.id)')
  })

  test('doctor/graph/health routes dispatch registered ids to the real-engine branch', () => {
    for (const route of ['doctor', 'graph', 'health']) {
      const src = readFileSync(join(ROOT, `src/app/api/wanyrix/${route}/route.ts`), 'utf8')
      expect(src).toContain('isRegisteredWorkspaceId')
      expect(src).toContain(`registered${route[0].toUpperCase()}${route.slice(1)}Payload`)
    }
  })

  test('doctor view labels not-measured telemetry instead of showing bare zeros', () => {
    const doctorView = readFileSync(join(ROOT, 'src/components/wanyrix/views/doctor-view.tsx'), 'utf8')
    expect(doctorView).toContain("buildTelemetry === 'not-measured'")
    expect(doctorView).toContain('Build telemetry is not measured')
  })

  test('Overview consumes the merged registry in Recent changes', () => {
    expect(overview).toContain('mergeWorkspaceRegistry')
  })
})
