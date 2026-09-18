/**
 * Task 2-a (AUDIT-I4) — live API contract suite.
 *
 * Exercises the real dev server (default http://localhost:3000, overridable
 * via WANYRIX_TEST_BASE_URL). By-design error contracts are pinned:
 *   - /api/wanyrix/impact  → 400 unknown `type` · 404 unknown `target`
 *   - /api/wanyrix/explain → 400 without `context`+`question` · 405 on GET
 *   - /api/wanyrix/report  → 400 unknown `format`
 * Workspace ids are discovered from /api/wanyrix/workspaces — never hardcoded
 * blind. If the server is unreachable the suite skips with a clear message
 * (the runner itself has no hard dependency on the server).
 */
import { describe, expect, test } from 'bun:test'

const BASE_URL = process.env.WANYRIX_TEST_BASE_URL ?? 'http://localhost:3000'
const FETCH_TIMEOUT_MS = 10_000

/* ------------------------------------------------------------- plumbing ---- */

interface JsonResponse {
  status: number
  contentType: string
  body: unknown
}

async function fetchJson(path: string, init?: RequestInit): Promise<JsonResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const contentType = res.headers.get('content-type') ?? ''
  const body: unknown = contentType.includes('application/json') ? await res.json() : null
  return { status: res.status, contentType, body }
}

function expectJson(res: JsonResponse): void {
  expect(res.contentType).toContain('application/json')
  expect(res.body).not.toBeNull()
}

async function serverReachable(): Promise<boolean> {
  // A few retries absorb transient dev-server recompile windows (parallel
  // agents edit src/** while this suite runs). Connection refused / timeout
  // over all attempts → genuinely unreachable.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/api/wanyrix/workspaces`, {
        signal: AbortSignal.timeout(3_000),
      })
      if (res.ok) return true
    } catch {
      // not reachable this attempt — retry
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 1_500))
  }
  return false
}

/* ------------------------------------------------- server-dependent setup -- */

const serverUp = await serverReachable()

if (!serverUp) {
  console.warn(
    `[wanyrix-api] dev server unreachable at ${BASE_URL} — skipping live API contract tests. ` +
      'Start it with `bun run dev` (or point WANYRIX_TEST_BASE_URL elsewhere).',
  )
}

const describeServer = describe.skipIf(!serverUp)

interface WorkspaceSummaryDto {
  id: string
  name: string
  crates: number
  edges: number
  status: string
}

interface RegistryDto {
  workspaces: WorkspaceSummaryDto[]
  default: string
}

let registry: RegistryDto | null = null
if (serverUp) {
  const res = await fetchJson('/api/wanyrix/workspaces')
  registry = res.body as RegistryDto
}

const WS_IDS = (registry?.workspaces ?? []).map((w) => w.id)
const PRIMARY = registry?.workspaces.find((w) => w.status === 'live') ?? registry?.workspaces[0]
const PRIMARY_ID = PRIMARY?.id ?? ''

/* -------------------------------------------------------------- contracts -- */

describeServer('Wanyrix API — workspace discovery', () => {
  test('GET /api/wanyrix/workspaces → 200 JSON with a usable registry', () => {
    expect(WS_IDS.length).toBeGreaterThan(0)
    expect(new Set(WS_IDS).size).toBe(WS_IDS.length)
    const defaultWs = registry?.default ?? ''
    expect(defaultWs.length).toBeGreaterThan(0)
    expect(WS_IDS).toContain(defaultWs)
    expect((registry?.workspaces ?? []).some((w) => w.status === 'live')).toBe(true)
    for (const w of registry?.workspaces ?? []) {
      expect(typeof w.id).toBe('string')
      expect(w.crates).toBeGreaterThan(0)
      expect(w.edges).toBeGreaterThan(0)
    }
  })
})

describeServer(`Wanyrix API — workspace-scoped payloads (ws discovered: ${WS_IDS.join(', ')})`, () => {
  for (const ws of WS_IDS) {
    test(`GET /api/wanyrix/health?ws=${ws} → 200, echoes workspace, sane KPI shape`, async () => {
      const res = await fetchJson(`/api/wanyrix/health?ws=${encodeURIComponent(ws)}`)
      expect(res.status).toBe(200)
      expectJson(res)
      const body = res.body as Record<string, unknown>
      expect(body.workspace).toBe(ws)
      expect(body.crates as number).toBeGreaterThan(0)
      expect(body.edges as number).toBeGreaterThan(0)
      expect(typeof body.toolchain).toBe('string')
      expect((body.cacheHitRate as number) >= 0 && (body.cacheHitRate as number) <= 100).toBe(true)
      expect(Object.keys(body.kpis as object)).toEqual(
        expect.arrayContaining([
          'buildPerformance',
          'ciCost',
          'dependencyRisk',
          'prRegressions',
          'architectureDebt',
          'runtimeBottlenecks',
        ]),
      )
      expect(String(body.lastScan)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    test(`GET /api/wanyrix/doctor?ws=${ws} → 200, findings with stable IDs + evidence`, async () => {
      const res = await fetchJson(`/api/wanyrix/doctor?ws=${encodeURIComponent(ws)}`)
      expect(res.status).toBe(200)
      expectJson(res)
      const body = res.body as {
        workspace: string
        buildTime: number
        findings: {
          id: string
          severity: string
          evidence: unknown[]
          measurementStatus: string
        }[]
      }
      expect(body.workspace).toBe(ws)
      expect(body.findings.length).toBeGreaterThan(0)
      const ids = body.findings.map((f) => f.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const f of body.findings) {
        expect(f.evidence.length).toBeGreaterThan(0)
        expect(['measured', 'estimated', 'verified']).toContain(f.measurementStatus)
        expect(['critical', 'warning', 'info']).toContain(f.severity)
      }
    })

    test(`GET /api/wanyrix/graph?ws=${ws} → 200, nodes/edges/meta consistent with health`, async () => {
      const graph = await fetchJson(`/api/wanyrix/graph?ws=${encodeURIComponent(ws)}`)
      const health = await fetchJson(`/api/wanyrix/health?ws=${encodeURIComponent(ws)}`)
      expect(graph.status).toBe(200)
      expectJson(graph)
      const body = graph.body as {
        nodes: { id: string }[]
        edges: { from: string; to: string }[]
        meta: { workspaceCrates: number; totalEdges: number }
      }
      const nodeIds = new Set(body.nodes.map((n) => n.id))
      expect(nodeIds.size).toBeGreaterThan(0)
      for (const e of body.edges) {
        expect(nodeIds.has(e.from)).toBe(true)
        expect(nodeIds.has(e.to)).toBe(true)
      }
      expect(body.meta.workspaceCrates).toBe((health.body as { crates: number }).crates)
      expect(body.meta.totalEdges).toBe((health.body as { edges: number }).edges)
    })
  }
})

describeServer('Wanyrix API — storage & report flavors', () => {
  test('GET /api/wanyrix/storage → 200, bounded rows with reclaimable flags', async () => {
    const res = await fetchJson('/api/wanyrix/storage')
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as {
      rows: { label: string; sizeMB: number; reclaimable: boolean }[]
      totalMB: number
      bound: string
      retention: string
    }
    expect(body.rows.length).toBeGreaterThan(0)
    for (const row of body.rows) {
      expect(row.label.length).toBeGreaterThan(0)
      expect(row.sizeMB).toBeGreaterThanOrEqual(0)
      expect(typeof row.reclaimable).toBe('boolean')
    }
    const rowSum = body.rows.reduce((acc, r) => acc + r.sizeMB, 0)
    expect(Math.abs(body.totalMB - rowSum)).toBeLessThan(0.05)
    expect(body.bound.length).toBeGreaterThan(0)
    expect(body.retention.length).toBeGreaterThan(0)
  })

  test(`GET /api/wanyrix/report?ws=${PRIMARY_ID}&format=json → 200 with wanyrix.report/v1 flavor`, async () => {
    const res = await fetchJson(`/api/wanyrix/report?ws=${encodeURIComponent(PRIMARY_ID)}&format=json`)
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as {
      filename: string
      bytes: number
      json: { schema: string; workspace: string; doctor: { findings: unknown[] } }
    }
    expect(body.json.schema).toBe('wanyrix.report/v1')
    expect(body.json.workspace).toBe(PRIMARY_ID)
    expect(body.json.doctor.findings.length).toBeGreaterThan(0)
    expect(body.filename).toBe(`wanyrix-report-${PRIMARY_ID}-${new Date().toISOString().slice(0, 10)}.json`)
    expect(body.bytes).toBeGreaterThan(0)
  })

  test(`GET /api/wanyrix/report?ws=${PRIMARY_ID}&format=markdown → 200 with markdown envelope`, async () => {
    const res = await fetchJson(`/api/wanyrix/report?ws=${encodeURIComponent(PRIMARY_ID)}&format=markdown`)
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as { filename: string; markdown: string; bytes: number }
    expect(body.markdown.startsWith(`# Wanyrix workspace report — ${PRIMARY_ID}`)).toBe(true)
    expect(body.filename.endsWith('.md')).toBe(true)
    expect(body.bytes).toBeGreaterThan(0)
    expect(body.markdown).toContain('_Honesty notes:_')
  })

  test('GET /api/wanyrix/report with unknown format → 400 JSON error (by design)', async () => {
    const res = await fetchJson(`/api/wanyrix/report?format=yaml`)
    expect(res.status).toBe(400)
    expectJson(res)
    expect((res.body as { error: string }).error).toContain('unknown format')
  })
})

describeServer('Wanyrix API — impact by-design error contracts', () => {
  test('unknown type → 400 JSON; unknown target → 404 JSON', async () => {
    const badType = await fetchJson('/api/wanyrix/impact?type=teleport')
    expect(badType.status).toBe(400)
    expectJson(badType)
    expect((badType.body as { error: string }).error).toContain("unknown type 'teleport'")

    const badTarget = await fetchJson('/api/wanyrix/impact?type=edit-file&target=no/such/file.rs')
    expect(badTarget.status).toBe(404)
    expectJson(badTarget)
    expect((badTarget.body as { error: string }).error).toContain('unknown target')
  })

  test('valid catalog target → 200 JSON, always labeled `estimated` (Gate 10/21)', async () => {
    const graph = await fetchJson(`/api/wanyrix/graph?ws=${encodeURIComponent(PRIMARY_ID)}`)
    const firstDep = (graph.body as { catalog: { addDeps: { id: string }[] } }).catalog.addDeps[0]
    expect(firstDep).toBeDefined()

    const res = await fetchJson(
      `/api/wanyrix/impact?type=add-dep&target=${encodeURIComponent(firstDep.id)}&ws=${encodeURIComponent(PRIMARY_ID)}`,
    )
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as { kind: string; measurementStatus: string; cleanDelta: number }
    expect(body.kind).toBe('add-dep')
    expect(body.measurementStatus).toBe('estimated')
    expect(Number.isFinite(body.cleanDelta)).toBe(true)
  })
})

describeServer('Wanyrix API — explain by-design error contracts', () => {
  test('POST without context/question → 400 JSON (grounding contract)', async () => {
    const res = await fetchJson('/api/wanyrix/explain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'only a question' }),
    })
    expect(res.status).toBe(400)
    expectJson(res)
    const body = res.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('context and question are required')
  })

  test('POST invalid JSON body → 400 JSON', async () => {
    const res = await fetchJson('/api/wanyrix/explain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    })
    expect(res.status).toBe(400)
    expectJson(res)
    expect((res.body as { error: string }).error).toContain('invalid JSON body')
  })

  test('GET /api/wanyrix/explain → 405 Method Not Allowed (POST-only surface)', async () => {
    const res = await fetch(`${BASE_URL}/api/wanyrix/explain`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    expect(res.status).toBe(405)
  })
})

describeServer('Wanyrix API — remaining read surfaces respond 200 JSON', () => {
  test('gates: verdict enum + non-empty gate table', async () => {
    const res = await fetchJson('/api/wanyrix/gates')
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as { verdict: string; gates: { id: number }[] }
    expect(['GO', 'CONDITIONAL GO', 'NO-GO']).toContain(body.verdict)
    expect(body.gates.length).toBeGreaterThan(0)
  })

  test(`experiments?ws=${PRIMARY_ID} echoes the workspace`, async () => {
    const res = await fetchJson(`/api/wanyrix/experiments?ws=${encodeURIComponent(PRIMARY_ID)}`)
    expect(res.status).toBe(200)
    expectJson(res)
    expect((res.body as { workspace: string }).workspace).toBe(PRIMARY_ID)
  })

  test('issues: traceability array with repo URLs', async () => {
    const res = await fetchJson('/api/wanyrix/issues')
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as { issues: { id: string; repoUrl: string }[] }
    expect(body.issues.length).toBeGreaterThan(0)
    for (const issue of body.issues) {
      expect(issue.repoUrl.startsWith('https://')).toBe(true)
    }
  })

  test(`diagnostics?ws=${PRIMARY_ID} serves borrow + request flows`, async () => {
    const res = await fetchJson(`/api/wanyrix/diagnostics?ws=${encodeURIComponent(PRIMARY_ID)}`)
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as { borrow: { steps: unknown[] }; request: { segments: unknown[] } }
    expect(body.borrow.steps.length).toBeGreaterThan(0)
    expect(body.request.segments.length).toBeGreaterThan(0)
  })

  test(`pr?ws=${PRIMARY_ID} serves the regression guard case`, async () => {
    const res = await fetchJson(`/api/wanyrix/pr?ws=${encodeURIComponent(PRIMARY_ID)}`)
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as { number: number; regressionPct: number }
    expect(Number.isFinite(body.regressionPct)).toBe(true)
    expect(body.number).toBeGreaterThan(0)
  })
})
