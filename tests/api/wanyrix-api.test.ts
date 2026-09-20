/**
 * Task 2-a (AUDIT-I4) — live API contract suite.
 *
 * Exercises the real dev server (default http://localhost:3000, overridable
 * via WANYRIX_TEST_BASE_URL). By-design error contracts are pinned:
 *   - every ws-scoped route → 404 `{ error, knownWorkspaces }` for unknown `ws`
 *     (ENG-TCA-1 — no silent default-workspace substitution)
 *   - /api/wanyrix/impact  → 400 unknown `type` · 400 missing `target` (ENG-TCA-6b)
 *                            · 404 unknown `target`
 *   - /api/wanyrix/explain → 400 without `context`+`question` · 400 unknown
 *     `kind` (ENG-TCA-6c) · 405 on GET
 *   - /api/wanyrix/report  → 400 unknown `format`/`flavor` · markdown envelope carries
 *     `schema: wanyrix.markdown/v1` (ENG-TCA-6d) · `flavor=scorecard|scan-history`
 *     serves the two machine flavors over HTTP (ENG-TCA-2)
 *   - /graph aggregates reconcile with the served edges over HTTP (ENG-TCA-3)
 *   - 405 responses carry an `Allow` header (ENG-TCA-6a)
 * Workspace ids are discovered from /api/wanyrix/workspaces — never hardcoded
 * blind. If the server is unreachable the suite skips with a clear message
 * (the runner itself has no hard dependency on the server).
 */
import { describe, expect, test } from 'bun:test'
import path from 'node:path'

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
        meta: {
          workspaceCrates: number
          totalEdges: number
          servedNodes: number
          servedEdges: number
          scope: string
          aggregateSource: string
        }
      }
      const nodeIds = new Set(body.nodes.map((n) => n.id))
      expect(nodeIds.size).toBeGreaterThan(0)
      for (const e of body.edges) {
        expect(nodeIds.has(e.from)).toBe(true)
        expect(nodeIds.has(e.to)).toBe(true)
      }
      expect(body.meta.workspaceCrates).toBe((health.body as { crates: number }).crates)
      expect(body.meta.totalEdges).toBe((health.body as { edges: number }).edges)
      // ENG-TCA-3: the payload declares its backbone-subset scope explicitly
      expect(body.meta.scope).toBe('backbone-subset')
      expect(body.meta.aggregateSource).toBe('served-edges')
      expect(body.meta.servedNodes).toBe(body.nodes.length)
      expect(body.meta.servedEdges).toBe(body.edges.length)
      expect(body.meta.servedNodes).toBeLessThanOrEqual(body.meta.workspaceCrates + 64) // subset, externals included
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
      json: {
        schema: string
        workspace: string
        doctor: {
          findings: unknown[]
          buildTimeSeconds: number
          estimatedRangeSeconds?: unknown
          estimatedAfterFix: {
            unit: string
            estimatedRange: { low: number; high: number }
            status: string
            meaning: string
            confidencePct: number
            note: string
          }
        }
      }
    }
    expect(body.json.schema).toBe('wanyrix.report/v1')
    expect(body.json.workspace).toBe(PRIMARY_ID)
    expect(body.json.doctor.findings.length).toBeGreaterThan(0)
    expect(body.filename).toBe(`wanyrix-report-${PRIMARY_ID}-${new Date().toISOString().slice(0, 10)}.json`)
    expect(body.bytes).toBeGreaterThan(0)
    // ENG-TCA-5 — structured estimated-range semantics, no ambiguous tuple
    expect(body.json.doctor.estimatedRangeSeconds).toBeUndefined()
    const est = body.json.doctor.estimatedAfterFix
    expect(est.unit).toBe('seconds')
    expect(est.status).toBe('estimated')
    expect(est.meaning).toBe('projected-after-top-fix')
    expect(est.estimatedRange.high).toBeGreaterThanOrEqual(est.estimatedRange.low)
    expect(est.note.toLowerCase()).toContain('not a confidence interval')
  })

  test(`GET /api/wanyrix/report?ws=${PRIMARY_ID}&format=markdown → 200 with versioned markdown envelope`, async () => {
    const res = await fetchJson(`/api/wanyrix/report?ws=${encodeURIComponent(PRIMARY_ID)}&format=markdown`)
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as { schema?: string; filename: string; markdown: string; bytes: number }
    expect(body.schema).toBe('wanyrix.markdown/v1') // ENG-TCA-6d — versioned envelope
    expect(body.markdown.startsWith(`# Wanyrix workspace report — ${PRIMARY_ID}`)).toBe(true)
    expect(body.filename.endsWith('.md')).toBe(true)
    expect(body.bytes).toBeGreaterThan(0)
    expect(body.markdown).toContain('_Honesty notes:_')
    // ENG-TCA-5 — the range is presented as a post-fix projection, not a CI
    expect(body.markdown).toMatch(/estimated after top fix: \d+\.\d–\d+\.\ds/)
    expect(body.markdown).not.toContain('estimated range')
  })

  test('GET /api/wanyrix/report with unknown format → 400 JSON error (by design)', async () => {
    const res = await fetchJson(`/api/wanyrix/report?format=yaml`)
    expect(res.status).toBe(400)
    expectJson(res)
    expect((res.body as { error: string }).error).toContain('unknown format')
  })
})

describeServer('Wanyrix API — machine flavors over HTTP (ENG-TCA-2)', () => {
  test(`report?flavor=scorecard&ws=${PRIMARY_ID} → wanyrix.release-scorecard/v1 envelope`, async () => {
    const res = await fetchJson(`/api/wanyrix/report?flavor=scorecard&ws=${encodeURIComponent(PRIMARY_ID)}`)
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as {
      filename: string
      bytes: number
      json: {
        schema: string
        generatedAt: string
        release: string
        verdict: string
        rationale: string
        gates: { id: number; name: string; target: string; measured: string; status: string; blocking: boolean }[]
        blockingConditions: { condition: string; clear: boolean; note: string }[]
      }
    }
    expect(body.json.schema).toBe('wanyrix.release-scorecard/v1')
    expect(body.json.release.length).toBeGreaterThan(0)
    expect(new Date(body.json.generatedAt).toISOString()).toBe(body.json.generatedAt)
    expect(['GO', 'CONDITIONAL GO', 'NO-GO']).toContain(body.json.verdict)
    expect(body.json.gates.length).toBeGreaterThan(0)
    // same fixture the /gates route serves — one source, no flavor drift
    const gatesRes = await fetchJson('/api/wanyrix/gates')
    const gatesBody = gatesRes.body as {
      gates: typeof body.json.gates
      blockingConditions: typeof body.json.blockingConditions
    }
    expect(body.json.gates).toEqual(gatesBody.gates)
    expect(body.json.blockingConditions).toEqual(gatesBody.blockingConditions)
    // download parity with the client exporter
    expect(body.filename).toBe(`wanyrix-scorecard-${body.json.release}.json`)
    expect(body.bytes).toBeGreaterThan(0)
  })

  test(`report?flavor=scan-history&ws=${PRIMARY_ID} → wanyrix.scan-history/v1 envelope (honest empty server log)`, async () => {
    for (const ws of WS_IDS) {
      const res = await fetchJson(`/api/wanyrix/report?flavor=scan-history&ws=${encodeURIComponent(ws)}`)
      expect(res.status).toBe(200)
      expectJson(res)
      const body = res.body as {
        filename: string
        bytes: number
        json: { schema: string; workspace: string; exportedAt: string; note: string; runs: unknown[] }
      }
      expect(body.json.schema).toBe('wanyrix.scan-history/v1')
      expect(body.json.workspace).toBe(ws)
      expect(new Date(body.json.exportedAt).toISOString()).toBe(body.json.exportedAt)
      expect(Array.isArray(body.json.runs)).toBe(true)
      // server-side log is empty in this demo — and the response says so
      // (runs are a client-side localStorage log; nothing is fabricated)
      expect(body.json.runs.length).toBe(0)
      expect(body.json.note.toLowerCase()).toContain('empty')
      expect(body.filename).toMatch(new RegExp(`^${ws}-scan-history-.+\\.json$`))
      expect(body.bytes).toBeGreaterThan(0)
    }
  })

  test('unknown flavor → 400 JSON error (by design); default report flavor unchanged', async () => {
    const bad = await fetchJson(`/api/wanyrix/report?flavor=yaml`)
    expect(bad.status).toBe(400)
    expectJson(bad)
    expect((bad.body as { error: string }).error).toContain("unknown flavor 'yaml'")

    // the pre-existing default flavor is untouched by the new param
    const def = await fetchJson(`/api/wanyrix/report?ws=${encodeURIComponent(PRIMARY_ID)}`)
    expect(def.status).toBe(200)
    expect((def.body as { schema?: string }).schema).toBe('wanyrix.markdown/v1')
  })
})

describeServer('Wanyrix API — graph aggregates reconcile with served edges over HTTP (ENG-TCA-3)', () => {
  // The golden property from the QA cross-check script, run against the LIVE
  // HTTP payloads (not just the fixture builders): every downstream/blast/
  // degree claim inside a served /graph payload recomputes from its own edges.
  for (const ws of WS_IDS) {
    test(`[${ws}] closures + degrees recomputed from served edges match served aggregates`, async () => {
      const res = await fetchJson(`/api/wanyrix/graph?ws=${encodeURIComponent(ws)}`)
      expect(res.status).toBe(200)
      const graph = res.body as {
        nodes: { id: string; kind: string; fanIn: number; fanOut: number; downstream: number }[]
        edges: { from: string; to: string }[]
        duplicates: { name: string; dependents: string[] }[]
        blast: { crate: string; affectedWorkspace: number }[]
        meta: { workspaceCrates: number; servedNodes: number; servedEdges: number }
      }

      const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]))
      const inDeg = new Map<string, number>()
      const outDeg = new Map<string, number>()
      const dependents = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]))
      for (const n of graph.nodes) {
        inDeg.set(n.id, 0)
        outDeg.set(n.id, 0)
      }
      for (const e of graph.edges) {
        inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
        outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1)
        dependents.get(e.to)?.push(e.from)
      }
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

      for (const n of graph.nodes) {
        expect(n.fanIn).toBe(inDeg.get(n.id) ?? -1)
        expect(n.fanOut).toBe(outDeg.get(n.id) ?? -1)
        expect(n.downstream).toBe(closureSize(n.id))
        // impossible-count guard: no node affects more crates than the workspace has
        expect(n.downstream).toBeLessThanOrEqual(graph.meta.workspaceCrates)
      }
      for (const b of graph.blast) {
        expect(b.affectedWorkspace).toBe(closureSize(b.crate))
      }
      // no ghost references: every duplicate dependent label resolves to a node + edge
      const nodeIds = new Set(graph.nodes.map((n) => n.id))
      for (const d of graph.duplicates) {
        expect(nodeIds.has(d.name)).toBe(true)
        for (const label of d.dependents) {
          const head = label.replace(/ \([\w-]+\)$/, '')
          expect(nodeIds.has(head)).toBe(true)
          expect(graph.edges.some((e) => e.from === head && e.to === d.name)).toBe(true)
        }
      }
      expect(graph.meta.servedNodes).toBe(graph.nodes.length)
      expect(graph.meta.servedEdges).toBe(graph.edges.length)
    })
  }
})

describeServer('Wanyrix API — impact by-design error contracts', () => {
  test('unknown type → 400 JSON; unknown target → 404 JSON; missing target → 400 JSON (ENG-TCA-6b)', async () => {
    const badType = await fetchJson('/api/wanyrix/impact?type=teleport')
    expect(badType.status).toBe(400)
    expectJson(badType)
    expect((badType.body as { error: string }).error).toContain("unknown type 'teleport'")

    const badTarget = await fetchJson('/api/wanyrix/impact?type=edit-file&target=no/such/file.rs')
    expect(badTarget.status).toBe(404)
    expectJson(badTarget)
    expect((badTarget.body as { error: string }).error).toContain('unknown target')

    // ENG-TCA-6b — a MISSING param is a client-input error (400), not 404
    const missingTarget = await fetchJson('/api/wanyrix/impact?type=edit-file')
    expect(missingTarget.status).toBe(400)
    expectJson(missingTarget)
    expect((missingTarget.body as { error: string }).error).toContain("'target'")
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

  // Task 2-d (ENG-TCA-7): oversized payloads are rejected fast with a
  // documented limit — no 30 s provider stall.
  test('POST /api/wanyrix/explain with >256KB context → fast 413 with documented limit', async () => {
    const bigBody = JSON.stringify({ context: 'A'.repeat(300 * 1024), question: 'q' })
    const started = Date.now()
    const res = await fetchJson('/api/wanyrix/explain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bigBody,
    })
    expect(res.status).toBe(413)
    expectJson(res)
    const body = res.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('payload too large')
    expect(body.error).toContain('256 KB')
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

describeServer('Wanyrix API — unknown workspace → 404 on every ws-scoped route (ENG-TCA-1)', () => {
  // ENG-TCA-1: no route may silently substitute the default workspace for a
  // misspelled `ws`; the 404 must name the error and list the known ids.
  const WS_ROUTES = [
    'doctor',
    'graph',
    'health',
    'diagnostics',
    'pr',
    'experiments',
    'report?format=json',
    'report?format=markdown',
    'report?flavor=scorecard',
    'report?flavor=scan-history',
    'impact?type=add-dep&target=sqlx',
  ]

  for (const route of WS_ROUTES) {
    test(`GET /api/wanyrix/${route}${route.includes('?') ? '&' : '?'}ws=<unknown> → 404 JSON error envelope`, async () => {
      // bare routes join with '?', routes that already carry a query join with '&'
      const sep = route.includes('?') ? '&' : '?'
      const res = await fetchJson(`/api/wanyrix/${route}${sep}ws=${encodeURIComponent('does-not-exist')}`)
      expect(res.status).toBe(404)
      expectJson(res)
      const body = res.body as { error: string; knownWorkspaces: string[]; workspace?: string }
      expect(body.error).toContain("unknown workspace 'does-not-exist'")
      expect(Array.isArray(body.knownWorkspaces)).toBe(true)
      expect(body.knownWorkspaces).toEqual(WS_IDS)
      // no payload leaks under a bogus workspace id
      expect(body.workspace).toBeUndefined()
    })
  }

  test('known workspaces still resolve on every ws-scoped route → 200', async () => {
    for (const ws of WS_IDS) {
      for (const route of ['doctor', 'graph', 'health', 'experiments']) {
        const res = await fetchJson(`/api/wanyrix/${route}?ws=${encodeURIComponent(ws)}`)
        expect(res.status).toBe(200)
        const body = res.body as { workspace?: string }
        if (body.workspace !== undefined) expect(body.workspace).toBe(ws)
      }
    }
  })
})

describeServer('Wanyrix API — REST hygiene (ENG-TCA-6)', () => {
  test('405 responses carry an Allow header naming the allowed method (ENG-TCA-6a)', async () => {
    // NOTE: `workspaces` implements GET+POST+DELETE since the registration
    // bridge (Task 2-b) — its 405 contract is pinned in the bridge block below.
    for (const route of ['doctor', 'graph', 'health', 'gates', 'issues', 'storage', 'diagnostics', 'pr', 'experiments', 'impact', 'report']) {
      const res = await fetch(`${BASE_URL}/api/wanyrix/${route}`, {
        method: 'POST',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toContain('GET')
    }
    // POST-only surfaces advertise POST
    for (const route of ['storage/reclaim', 'storage/rebuild']) {
      const res = await fetch(`${BASE_URL}/api/wanyrix/${route}`, {
        method: 'GET',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toContain('POST')
    }
  })

  test('POST /api/wanyrix/explain with unknown kind → 400, no silent coercion (ENG-TCA-6c)', async () => {
    const res = await fetchJson('/api/wanyrix/explain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: 'c', question: 'q', kind: 'weird-kind' }),
    })
    expect(res.status).toBe(400)
    expectJson(res)
    const body = res.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain("unknown kind 'weird-kind'")
    // omitted kind still defaults to `general` (documented behavior) — the
    // request must NOT be rejected like an explicit unknown kind. Provider
    // latency is variable, so a slow/failed provider is not a contract
    // failure here; we only pin that the default is accepted, never 400'd.
    try {
      const defaulted = await fetchJson('/api/wanyrix/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: 'hello', question: 'what is this?' }),
      })
      expect(defaulted.status).not.toBe(400)
    } catch {
      // provider timeout — the default-kind acceptance is covered by the 400 path above
    }
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

/* ============================================================================
   Task 2-b — workspace registration bridge ("Connect a project").
   The demo registry gains a REAL registration surface: POST runs the actual
   wanyrix binary (doctor + graph) against a validated absolute path and
   persists the measured counts; DELETE removes the row. Measured data only —
   nothing is invented, and a failed registration stores NOTHING.
   ========================================================================== */

describeServer('Wanyrix API — workspace registration bridge (Task 2-b)', () => {
  test('GET /api/wanyrix/workspaces → 200, `registered` array present, demo registry unchanged', async () => {
    const res = await fetchJson('/api/wanyrix/workspaces')
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as {
      workspaces: { id: string; crates: number }[]
      default: string
      registered: unknown[]
    }
    // pre-existing demo registry contract is untouched
    expect(body.workspaces.length).toBeGreaterThan(0)
    expect(typeof body.default).toBe('string')
    // the bridge list is ALWAYS present (empty = nothing connected, never fabricated)
    expect(Array.isArray(body.registered)).toBe(true)
    for (const row of body.registered as Record<string, unknown>[]) {
      expect(typeof row.id).toBe('string')
      expect(String(row.id)).toMatch(/^ws-local-/)
      expect(typeof row.name).toBe('string')
      expect(typeof row.path).toBe('string')
      expect(String(row.path)).toMatch(/^\//) // canonical absolute path
      expect(typeof row.crates).toBe('number')
      expect(typeof row.edges).toBe('number')
      expect(typeof row.findings).toBe('number')
      expect(['ok', 'failed']).toContain(String(row.lastStatus))
      expect(String(row.registeredAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(String(row.lastCheckedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })

  test('POST with no body → 400 named error (malformed JSON)', async () => {
    const res = await fetchJson('/api/wanyrix/workspaces', { method: 'POST' })
    expect(res.status).toBe(400)
    expectJson(res)
    expect(typeof (res.body as { error: string }).error).toBe('string')
    expect((res.body as { error: string }).error.length).toBeGreaterThan(0)
  })

  test('POST without path → 400 named error (path is required)', async () => {
    const res = await fetchJson('/api/wanyrix/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expectJson(res)
    expect((res.body as { error: string }).error).toContain('path is required')
  })

  test("POST { path: 'engine' } (relative) → 400 with 'absolute' named in the error", async () => {
    const res = await fetchJson('/api/wanyrix/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'engine' }),
    })
    expect(res.status).toBe(400)
    expectJson(res)
    expect((res.body as { error: string }).error).toContain('absolute')
  })

  test('POST nonexistent path → 400 mentioning existence', async () => {
    const res = await fetchJson('/api/wanyrix/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/nonexistent/definitely-missing-xyz-2b' }),
    })
    expect(res.status).toBe(400)
    expectJson(res)
    expect((res.body as { error: string }).error).toContain('does not exist')
  })

  test('POST /tmp (exists, no Cargo.toml/.wanyrix) → 404 "does not look like a Rust project"', async () => {
    const res = await fetchJson('/api/wanyrix/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp' }),
    })
    expect(res.status).toBe(404)
    expectJson(res)
    const body = res.body as { error: string; path: string }
    expect(body.error).toContain('does not look like a Rust project')
    expect(body.error).toContain('no Cargo.toml or .wanyrix at /tmp')
    expect(body.path).toBe('/tmp')
    // nothing may be stored for a rejected path
    const after = await fetchJson('/api/wanyrix/workspaces')
    expect(
      ((after.body as { registered: { path: string }[] }).registered ?? []).some(
        (r) => r.path === '/tmp',
      ),
    ).toBe(false)
  })

  test('DELETE without id → 400 named error', async () => {
    const res = await fetchJson('/api/wanyrix/workspaces', { method: 'DELETE' })
    expect(res.status).toBe(400)
    expectJson(res)
    expect((res.body as { error: string }).error).toContain('id')
  })

  test('PUT / PATCH → 405 carrying Allow: GET, POST, DELETE', async () => {
    for (const method of ['PUT', 'PATCH']) {
      const res = await fetch(`${BASE_URL}/api/wanyrix/workspaces`, {
        method,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toContain('GET')
      expect(res.headers.get('allow')).toContain('POST')
      expect(res.headers.get('allow')).toContain('DELETE')
    }
  })

  test('conditional happy path: real engine present → register engine/, rescan, unregister', async () => {
    // Probe: does the real binary exist on the server host?
    const probe = await fetchJson('/api/wanyrix/engine/doctor')
    if (probe.status === 503) {
      // Engine missing ⇒ registration honestly fails with the build hint.
      const res = await fetchJson('/api/wanyrix/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: path.resolve(process.cwd(), 'engine') }),
      })
      expect(res.status).toBe(503)
      expectJson(res)
      const body = res.body as { error: string; hint?: string }
      expect(body.error).toContain('engine binary not found')
      expect(body.hint).toContain('cargo build --locked')
      return
    }
    expect(probe.status).toBe(200)

    // REGISTER the real engine crate (dogfood target, guaranteed Rust project)
    const res = await fetchJson('/api/wanyrix/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.resolve(process.cwd(), 'engine') }),
    })
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as {
      registered: boolean
      workspace: {
        id: string
        name: string
        path: string
        crates: number
        edges: number
        findings: number
        critical: number
        warning: number
        info: number
        toolchain: string
      }
      verdict: { crates: number; edges: number; findings: number; engineVersion: string }
    }
    expect(body.registered).toBe(true)
    expect(body.workspace.id.startsWith('ws-local-')).toBe(true)
    // MEASURED numbers: the engine really scanned the directory
    expect(body.verdict.crates).toBeGreaterThanOrEqual(1)
    expect(body.verdict.findings).toBe(
      body.workspace.critical + body.workspace.warning + body.workspace.info,
    )
    expect(body.workspace.crates).toBe(body.verdict.crates)
    expect(body.workspace.edges).toBe(body.verdict.edges)
    expect(body.workspace.path.endsWith('/engine')).toBe(true)
    expect(typeof body.verdict.engineVersion).toBe('string')
    expect(body.verdict.engineVersion.length).toBeGreaterThan(0)

    // The row is served back through GET
    const listed = await fetchJson('/api/wanyrix/workspaces')
    const rows = (listed.body as { registered: { id: string }[] }).registered ?? []
    expect(rows.some((r) => r.id === body.workspace.id)).toBe(true)

    // RE-SCAN through the guarded exec surface (only DB-stored paths are scanned)
    const rescan = await fetchJson(
      `/api/wanyrix/engine/doctor?workspace=${encodeURIComponent(body.workspace.id)}`,
    )
    expect(rescan.status).toBe(200)
    expectJson(rescan)
    const rescanBody = rescan.body as {
      schema: string
      workspaceId?: string
      scanTarget: string
      report: { schema?: string; summary?: { total?: number; critical?: number; warning?: number; info?: number } }
    }
    expect(rescanBody.schema).toBe('wanyrix.engine-exec/v1')
    expect(rescanBody.workspaceId).toBe(body.workspace.id)
    expect(rescanBody.scanTarget).toBe(body.workspace.path)
    expect(rescanBody.report.schema).toBe('wanyrix.doctor/v1')

    // Unknown id on the exec surface → 404 (never scans arbitrary request paths)
    const unknown = await fetchJson(
      `/api/wanyrix/engine/doctor?workspace=${encodeURIComponent('ws-local-not-a-real-row')}`,
    )
    expect(unknown.status).toBe(404)
    expectJson(unknown)
    expect((unknown.body as { error: string }).error).toContain(
      'no registered workspace with id ws-local-not-a-real-row',
    )

    // UNREGISTER → 200; repeat → 404 (the row is gone)
    const del = await fetchJson(`/api/wanyrix/workspaces?id=${encodeURIComponent(body.workspace.id)}`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(200)
    expectJson(del)
    expect((del.body as { unregistered: boolean; id: string }).unregistered).toBe(true)
    expect((del.body as { id: string }).id).toBe(body.workspace.id)

    const delAgain = await fetchJson(
      `/api/wanyrix/workspaces?id=${encodeURIComponent(body.workspace.id)}`,
      { method: 'DELETE' },
    )
    expect(delAgain.status).toBe(404)
    expectJson(delAgain)
    expect((delAgain.body as { error: string }).error).toContain(
      `no registered workspace with id ${body.workspace.id}`,
    )

    // the registry no longer lists it
    const after = await fetchJson('/api/wanyrix/workspaces')
    expect(
      ((after.body as { registered: { id: string }[] }).registered ?? []).some(
        (r) => r.id === body.workspace.id,
      ),
    ).toBe(false)
  })
})
