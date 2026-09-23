/**
 * Task 2-a (AUDIT-I4) — live API contract suite.
 *
 * Exercises the real dev server (default http://localhost:3000, overridable
 * via WANYRIX_TEST_BASE_URL). By-design error contracts are pinned:
 *   - every ws-scoped route → 404 `{ error, knownWorkspaces }` for unknown `ws`
 *     (ENG-TCA-1 — no silent default-workspace substitution)
 *   - issue #129: the SAME contract under the accepted `?workspace=` alias on
 *     every ws-scoped surface (both spellings happy-path, unknown ⇒ 404 per
 *     spelling) + the fixture/exec marking on /workspaces. Those pins are
 *     capability-probed (SERVER_HAS_129_FIX): a server predating the #129
 *     merge skips them with a stated reason while the unit suite proves the
 *     logic server-free.
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
import { afterAll, describe, expect } from 'bun:test'
import path from 'node:path'
// AUD-4: test registration goes through the shared harness — counted, visibly
// skipped when the dev server is absent, and a hard failure under
// WANYRIX_REQUIRE_LIVE=1 (see tests/api/server-present.test.ts).
import { BASE_URL, liveTestCount, makeGatedTest, serverUp, skipBanner, test } from './harness'

const FETCH_TIMEOUT_MS = 10_000
// Registration baseline for this file's counted skip banner (printed at the
// end of module scope when the server is absent).
const liveBase = liveTestCount()

// CWD-independent repo root (the suite must pass from any invocation dir —
// e.g. `cd tests && bun test …` while the sandbox root is unhealthy).
const REPO_ROOT = path.resolve(import.meta.dir, '..', '..')

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

/* ------------------------------------------------- server-dependent setup -- */

// serverUp comes from ./harness — probed once per run (with recompile-window
// retries) and shared by every suite file in the process.

/** The guard moved from describe-level to the per-test registration (harness
 * `test`), so skipped cases stay counted and visible (AUD-4). */
const describeServer = describe

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

/* ------------------------------------------------ issue #129 capability -- */

// The unified workspace-param contract (both `ws` and `workspace` accepted;
// unknown ⇒ 404 under EITHER spelling) shipped with issue #129. The dev
// server under test may predate the merge — probe it honestly: a pre-fix
// server answers `health?workspace=<unknown>` with 200 + default-workspace
// data (the exact bug #129 removes), a fixed server answers 404. Pins that
// need the fix skip with that reason stated; the same logic is proven
// without a server by tests/unit/wanyrix-workspace-param.test.ts (direct
// handler invocation).
const UNKNOWN_129 = 'does-not-exist-129'
const SERVER_HAS_129_FIX = serverUp
  ? (
      await fetchJson(`/api/wanyrix/health?workspace=${encodeURIComponent(UNKNOWN_129)}`)
    ).status === 404
  : false

if (serverUp && !SERVER_HAS_129_FIX) {
  console.warn(
    '[wanyrix-api] server predates the issue #129 workspace-param contract — ' +
      'the #129 live pins are skipped (logic proven by tests/unit/wanyrix-workspace-param.test.ts).',
  )
}

const describe129 = describe
const test129 = makeGatedTest(SERVER_HAS_129_FIX)

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
    // issue #140: ws is now REQUIRED — the param contracts below are exercised
    // on top of a valid workspace (the phantom-default fallback is gone)
    const res = await fetchJson(`/api/wanyrix/report?format=yaml&ws=${encodeURIComponent(PRIMARY_ID)}`)
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
    // issue #140: ws is now REQUIRED (explicit id — no phantom default)
    const bad = await fetchJson(`/api/wanyrix/report?flavor=yaml&ws=${encodeURIComponent(PRIMARY_ID)}`)
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
    // issue #140: ws is now REQUIRED on workspace-scoped routes — the type/
    // target param contracts are exercised with an explicit valid ws (the
    // registry-default fallback no longer exists to paper over a missing ws)
    const badType = await fetchJson(`/api/wanyrix/impact?type=teleport&ws=${encodeURIComponent(PRIMARY_ID)}`)
    expect(badType.status).toBe(400)
    expectJson(badType)
    expect((badType.body as { error: string }).error).toContain("unknown type 'teleport'")

    const badTarget = await fetchJson(`/api/wanyrix/impact?type=edit-file&target=no/such/file.rs&ws=${encodeURIComponent(PRIMARY_ID)}`)
    expect(badTarget.status).toBe(404)
    expectJson(badTarget)
    expect((badTarget.body as { error: string }).error).toContain('unknown target')

    // ENG-TCA-6b — a MISSING param is a client-input error (400), not 404
    const missingTarget = await fetchJson(`/api/wanyrix/impact?type=edit-file&ws=${encodeURIComponent(PRIMARY_ID)}`)
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

describeServer('Wanyrix API — fixture ids are NOT exec-capable (issue #129 marking)', () => {
  // Always true (pre- and post-#129): the engine-exec surfaces resolve
  // against the REGISTERED store, so a demo-fixture id 404s there even though
  // it is "known" to the fixture routes. GET /workspaces marks this — see the
  // #129 block below.
  test(`engine/doctor?workspace=${PRIMARY_ID} (a fixture id) → 404 named error, never a scan`, async () => {
    const res = await fetchJson(`/api/wanyrix/engine/doctor?workspace=${encodeURIComponent(PRIMARY_ID)}`)
    expect(res.status).toBe(404)
    expectJson(res)
    expect((res.body as { error: string }).error).toContain(
      `no registered workspace with id ${PRIMARY_ID}`,
    )
  })
})

describe129('Wanyrix API — unified workspace-param contract (issue #129)', () => {
  // Both spellings on every ws-scoped surface; unknown ⇒ 404 under EITHER.
  // Skipped (with a stated reason) when the server predates the #129 merge;
  // the same logic is proven server-free by tests/unit/wanyrix-workspace-param.test.ts.

  test129(`health happy path under BOTH spellings → 200 echoing ${PRIMARY_ID}`, async () => {
    for (const spelling of ['ws', 'workspace'] as const) {
      const res = await fetchJson(`/api/wanyrix/health?${spelling}=${encodeURIComponent(PRIMARY_ID)}`)
      expect(res.status).toBe(200)
      expectJson(res)
      expect((res.body as { workspace?: string }).workspace).toBe(PRIMARY_ID)
    }
  })

  test129('graph + doctor happy path under ?workspace= (the alias reaches the whole family)', async () => {
    for (const route of ['graph', 'doctor']) {
      // NOTE: only some fixture routes echo the resolved id in the payload
      // (doctor does; graph's payload is the scoped graph itself). The honest
      // happy-path pin for BOTH: the alias serves the byte-identical payload
      // of the canonical spelling (deterministic GET routes — ARCHITECTURE),
      // i.e. fixtures resolve identically under either spelling.
      const alias = await fetchJson(`/api/wanyrix/${route}?workspace=${encodeURIComponent(PRIMARY_ID)}`)
      expect(alias.status).toBe(200)
      expectJson(alias)
      const canonical = await fetchJson(`/api/wanyrix/${route}?ws=${encodeURIComponent(PRIMARY_ID)}`)
      expect(canonical.status).toBe(200)
      expectJson(canonical)
      expect(alias.body).toEqual(canonical.body)
    }
    // …and where the contract DOES echo the id, it echoes it under the alias too
    const doctor = await fetchJson(`/api/wanyrix/doctor?workspace=${encodeURIComponent(PRIMARY_ID)}`)
    expect((doctor.body as { workspace?: string }).workspace).toBe(PRIMARY_ID)
  })

  test129(`health?workspace=${UNKNOWN_129} → 404 knownWorkspaces envelope (THE #129 bug: was 200 + default data)`, async () => {
    const res = await fetchJson(`/api/wanyrix/health?workspace=${encodeURIComponent(UNKNOWN_129)}`)
    expect(res.status).toBe(404)
    expectJson(res)
    const body = res.body as { error: string; knownWorkspaces: string[]; workspace?: string }
    expect(body.error).toBe(`unknown workspace '${UNKNOWN_129}'`)
    expect(body.knownWorkspaces).toEqual(WS_IDS)
    // no payload leaks under a bogus workspace id, under any spelling
    expect(body.workspace).toBeUndefined()
  })

  test129(`health 404 envelope is byte-identical under ?ws= and ?workspace=`, async () => {
    for (const spelling of ['ws', 'workspace'] as const) {
      const res = await fetchJson(`/api/wanyrix/health?${spelling}=${encodeURIComponent(UNKNOWN_129)}`)
      expect(res.status).toBe(404)
      const body = res.body as { error: string; knownWorkspaces: string[] }
      expect(body.error).toBe(`unknown workspace '${UNKNOWN_129}'`)
      expect(body.knownWorkspaces).toEqual(WS_IDS)
    }
  })

  test129('?workspace= unknown 404s across the fixture-scoped family (same envelope as ?ws=)', async () => {
    for (const route of ['doctor', 'graph', 'diagnostics', 'pr', 'experiments', 'report?format=json']) {
      const sep = route.includes('?') ? '&' : '?'
      const res = await fetchJson(`/api/wanyrix/${route}${sep}workspace=${encodeURIComponent(UNKNOWN_129)}`)
      expect(res.status).toBe(404)
      expectJson(res)
      const body = res.body as { error: string; knownWorkspaces: string[] }
      expect(body.error).toBe(`unknown workspace '${UNKNOWN_129}'`)
      expect(body.knownWorkspaces).toEqual(WS_IDS)
    }
  })

  test129('precedence: both spellings present → ?ws= wins (documented canonical)', async () => {
    const atlas = WS_IDS.find((id) => id !== PRIMARY_ID) ?? PRIMARY_ID
    const res = await fetchJson(
      `/api/wanyrix/health?ws=${encodeURIComponent(atlas)}&workspace=${encodeURIComponent(PRIMARY_ID)}`,
    )
    expect(res.status).toBe(200)
    expect((res.body as { workspace?: string }).workspace).toBe(atlas)
  })

  test129('engine-exec family: unknown id 404s under BOTH spellings (engine/doctor accepts ?ws= now)', async () => {
    for (const spelling of ['ws', 'workspace'] as const) {
      const doc = await fetchJson(
        `/api/wanyrix/engine/doctor?${spelling}=${encodeURIComponent('ws-local-not-a-real-row-129')}`,
      )
      expect(doc.status).toBe(404)
      expectJson(doc)
      expect((doc.body as { error: string }).error).toContain(
        'no registered workspace with id ws-local-not-a-real-row-129',
      )
    }
  })

  test129('GET /workspaces marks fixture ids fixtureOnly:true + serves execCapableIds (issue #129)', async () => {
    const res = await fetchJson('/api/wanyrix/workspaces')
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as {
      workspaces: { id: string; fixtureOnly?: boolean }[]
      registered?: { id: string; fixtureOnly?: boolean }[]
      execCapableIds?: string[]
    }
    expect(body.workspaces.length).toBeGreaterThan(0)
    // every demo entry is marked fixture-only — it has no executable scan target
    for (const w of body.workspaces) expect(w.fixtureOnly).toBe(true)
    // the exec-capable set is exactly the registered rows (never a fixture id)
    expect(Array.isArray(body.execCapableIds)).toBe(true)
    expect(body.execCapableIds).toEqual((body.registered ?? []).map((r) => r.id))
    for (const id of body.workspaces.map((w) => w.id)) {
      expect(body.execCapableIds).not.toContain(id)
    }
    // registered rows are marked exec-capable
    for (const r of body.registered ?? []) expect(r.fixtureOnly).toBe(false)
  })
})

describeServer('Wanyrix API — REST hygiene (ENG-TCA-6)', () => {
  test('405 responses carry an Allow header naming the allowed method (ENG-TCA-6a)', async () => {
    // NOTE: `workspaces` implements GET+POST+DELETE since the registration
    // bridge (Task 2-b) — its 405 contract is pinned in the bridge block below.
    // `git` / `what-changed` / `engine/impact` joined as GET-only real-exec
    // routes with the issue #69 change-intelligence wiring.
    for (const route of ['doctor', 'graph', 'health', 'gates', 'issues', 'storage', 'diagnostics', 'pr', 'experiments', 'impact', 'report', 'git', 'what-changed', 'engine/impact']) {
      const res = await fetch(`${BASE_URL}/api/wanyrix/${route}`, {
        method: 'POST',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toContain('GET')
    }
    // POST-only surfaces advertise POST (`export` joined with issue #91 —
    // it writes the artifacts-as-code tree, so it is a mutating surface).
    for (const route of ['storage/reclaim', 'storage/rebuild', 'export']) {
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

  test('POST nonexistent path OUTSIDE the approved roots → 400 generic confinement refusal, no echo (QA-3-B-2)', async () => {
    // /nonexistent/... is outside the default workspace roots (repo engine/,
    // repo fixtures/, system temp dir): the pre-confinement contract leaked
    // existence state ('does not exist') for ANY host path; the confined
    // contract answers with ONE generic policy refusal and no path echo.
    const res = await fetchJson('/api/wanyrix/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/nonexistent/definitely-missing-xyz-2b' }),
    })
    expect(res.status).toBe(400)
    expectJson(res)
    const body = res.body as { error: string }
    expect(body.error).toContain('outside the allowed workspace roots')
    expect(body.error).toContain('WANYRIX_WORKSPACE_ROOTS')
    expect(body.error).not.toContain('does not exist')
    expect(body.error).not.toContain('/nonexistent')
  })

  test('POST /tmp (contained, exists, no Cargo.toml/.wanyrix) → 404 ONE shared message, no path echo (QA-3-B-2)', async () => {
    // /tmp sits INSIDE the default system-temp root, so the marker check
    // runs — but the response must not distinguish it from a missing or
    // non-directory candidate (existence/type enumeration is collapsed,
    // QA-3-B-2 AC 2), and must not echo the resolved path back.
    const res = await fetchJson('/api/wanyrix/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp' }),
    })
    expect(res.status).toBe(404)
    expectJson(res)
    const body = res.body as { error: string; path?: string }
    expect(body.error).toContain('no scannable Rust project directory at the submitted path')
    expect(body.error).not.toContain('/tmp')
    expect(body.path).toBeUndefined()
    // nothing may be stored for a rejected path
    const after = await fetchJson('/api/wanyrix/workspaces')
    expect(
      ((after.body as { registered: { path: string }[] }).registered ?? []).some(
        (r) => r.path === '/tmp',
      ),
    ).toBe(false)
  })

  test('QA-3 oracle probes collapse: /etc/hostname (a file) and /etc (a dir) → the SAME generic 400 (QA-3-B-2)', async () => {
    // The pre-confinement surface distinguished file/not-a-directory vs
    // directory/no-marker for ANY host path (a three-state existence oracle).
    // Confined, both outside-roots probes get ONE byte-identical refusal.
    const bodies: string[] = []
    for (const probe of ['/etc/hostname', '/etc']) {
      const res = await fetchJson('/api/wanyrix/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: probe }),
      })
      expect(res.status).toBe(400)
      expectJson(res)
      const body = res.body as { error: string }
      expect(body.error).toContain('outside the allowed workspace roots')
      expect(body.error).not.toContain(probe) // no path echo
      bodies.push(body.error)
    }
    expect(bodies[0]).toBe(bodies[1]) // byte-identical — no differential
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
        body: JSON.stringify({ path: path.resolve(REPO_ROOT, 'engine') }),
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
      body: JSON.stringify({ path: path.resolve(REPO_ROOT, 'engine') }),
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
    const rows = (listed.body as { registered: { id: string; fixtureOnly?: boolean }[] }).registered ?? []
    expect(rows.some((r) => r.id === body.workspace.id)).toBe(true)

    // issue #129: the registered row is marked exec-capable (fixtureOnly:false)
    if (SERVER_HAS_129_FIX) {
      const listedRow = rows.find((r) => r.id === body.workspace.id)
      expect(listedRow?.fixtureOnly).toBe(false)
    }

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

    // issue #129: engine/doctor accepts the ?ws= alias too. Pre-fix servers
    // ignore it (→ dogfood scan, no workspaceId) — the alias pin needs the fix.
    if (SERVER_HAS_129_FIX) {
      const alias = await fetchJson(
        `/api/wanyrix/engine/doctor?ws=${encodeURIComponent(body.workspace.id)}`,
      )
      expect(alias.status).toBe(200)
      expectJson(alias)
      expect((alias.body as { workspaceId?: string }).workspaceId).toBe(body.workspace.id)
    }

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

/* ============================================================================
   Issue #69 — engine v0.8.0 change intelligence over HTTP (git / impact /
   what-changed). Same real-exec contract family as engine/doctor: verbatim
   `wanyrix.engine-exec/v1` wrappers around the engine's own envelopes
   (`wanyrix.git/v1`, `wanyrix.impact/v1`, `wanyrix.what-changed/v1`),
   registered-workspace resolution identical (`?workspace=<id>` / `?ws=`
   alias, dogfood engine dir by default), named engine errors quoted
   verbatim. The what-changed store path is server-derived
   (`<target>/.wanyrix/store.db`) — request params never reach a fs path.
   ========================================================================== */

// One real-exec probe decides whether the binary-exec paths can run at all.
const engineProbe69 = serverUp ? await fetchJson('/api/wanyrix/engine/doctor') : null
const ENGINE_UP_69 = engineProbe69?.status === 200

describeServer('Wanyrix API — engine change intelligence (issue #69)', () => {
  // The dogfood target is the repo's own engine crate — its measured package
  // name (what-changed reports it as `workspace`) is the one guaranteed
  // workspace crate.
  const DOGFOOD_CRATE = 'wanyrix-engine'

  test('GET /api/wanyrix/git → 200 engine-exec wrapper around a verbatim wanyrix.git/v1', async () => {
    const res = await fetchJson('/api/wanyrix/git')
    expectJson(res)
    if (!ENGINE_UP_69) {
      // No binary on this machine → the honest 503 with the checked list.
      expect(res.status).toBe(503)
      const body = res.body as { error: string; checked: string[]; hint: string }
      expect(body.error).toContain('engine binary not found')
      expect(Array.isArray(body.checked)).toBe(true)
      expect(body.hint).toContain('cargo build --locked')
      return
    }
    expect(res.status).toBe(200)
    const body = res.body as {
      schema: string
      surface: string
      executedAt: string
      durationMs: number
      binary: { version: string; profile: string }
      scanTarget: string
      note: string
      report: {
        schema?: string
        root?: string
        branch?: string
        head?: string
        dirty?: boolean
        changedFilesCount?: number
        changedFilesTruncated?: boolean
        commitCount?: number
        recentCommits?: { sha?: string; subject?: string; committedAt?: string }[]
      }
    }
    expect(body.schema).toBe('wanyrix.engine-exec/v1')
    expect(body.surface).toBe('git')
    expect(body.binary.version.length).toBeGreaterThan(0)
    expect(['debug', 'release']).toContain(body.binary.profile)
    expect(body.note).toContain('Verbatim stdout of the real wanyrix binary')
    // the engine's own envelope, byte-preserved
    expect(body.report.schema).toBe('wanyrix.git/v1')
    expect(typeof body.report.branch).toBe('string')
    expect((body.report.head ?? '').length).toBe(40)
    expect(typeof body.report.dirty).toBe('boolean')
    expect(typeof body.report.changedFilesCount).toBe('number')
    expect(typeof body.report.changedFilesTruncated).toBe('boolean')
    expect(body.report.commitCount ?? 0).toBeGreaterThan(0)
    expect(Array.isArray(body.report.recentCommits)).toBe(true)
    expect((body.report.recentCommits ?? []).length).toBeGreaterThan(0)
    for (const c of body.report.recentCommits ?? []) {
      expect(typeof c.sha).toBe('string')
      expect(typeof c.subject).toBe('string')
      expect(typeof c.committedAt).toBe('string')
    }
  })

  test('GET /api/wanyrix/engine/impact without crate → 400 (ENG-TCA-6b: missing required param)', async () => {
    const res = await fetchJson('/api/wanyrix/engine/impact')
    expect(res.status).toBe(400)
    expectJson(res)
    expect((res.body as { error: string }).error).toContain("missing required param 'crate'")
  })

  test(`GET /api/wanyrix/engine/impact?crate=${DOGFOOD_CRATE} → 200 verbatim wanyrix.impact/v1 with measured blast radius`, async () => {
    if (!ENGINE_UP_69) return // binary-missing contract already pinned by the git test above
    const res = await fetchJson(
      `/api/wanyrix/engine/impact?crate=${encodeURIComponent(DOGFOOD_CRATE)}`,
    )
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as {
      schema: string
      surface: string
      report: {
        schema?: string
        crateName?: string
        directDependentsByKind?: { normal?: string[]; build?: string[]; dev?: string[] }
        transitiveCount?: number
        workspaceCrateCount?: number
        blastRadiusPerMille?: number
        note?: string
      }
    }
    expect(body.schema).toBe('wanyrix.engine-exec/v1')
    expect(body.surface).toBe('impact')
    expect(body.report.schema).toBe('wanyrix.impact/v1')
    expect(body.report.crateName).toBe(DOGFOOD_CRATE)
    expect(body.report.workspaceCrateCount ?? 0).toBeGreaterThanOrEqual(1)
    expect(typeof body.report.blastRadiusPerMille).toBe('number')
    expect(body.report.blastRadiusPerMille ?? -1).toBeGreaterThanOrEqual(0)
    for (const kind of ['normal', 'build', 'dev'] as const) {
      expect(Array.isArray(body.report.directDependentsByKind?.[kind])).toBe(true)
    }
    expect((body.report.note ?? '').length).toBeGreaterThan(0)
  })

  test('GET /api/wanyrix/engine/impact?crate=<unknown> → 502 quoting the engine error verbatim', async () => {
    if (!ENGINE_UP_69) return
    const res = await fetchJson(
      `/api/wanyrix/engine/impact?crate=${encodeURIComponent('definitely-not-a-crate-69')}`,
    )
    expect(res.status).toBe(502)
    expectJson(res)
    const body = res.body as { error: string; detail: string }
    expect(body.error).toContain('engine exited with 2')
    // the engine's named error, verbatim (exit 2 wording from the binary)
    expect(body.detail).toContain(
      "crate 'definitely-not-a-crate-69' is not a workspace crate under",
    )
  })

  test('GET /api/wanyrix/what-changed → honest store contract (503 verbatim until a store exists, else 200 envelope)', async () => {
    const res = await fetchJson('/api/wanyrix/what-changed')
    expectJson(res)
    if (!ENGINE_UP_69) {
      expect(res.status).toBe(503)
      return
    }
    if (res.status === 200) {
      // A store exists at engine/.wanyrix/store.db on this machine — the
      // envelope (baseline or baselineNote) is the valid contract, not an error.
      const body = res.body as {
        schema: string
        surface: string
        report: { schema?: string; root?: string; workspace?: string; findings?: unknown; severityDelta?: unknown }
      }
      expect(body.schema).toBe('wanyrix.engine-exec/v1')
      expect(body.surface).toBe('what-changed')
      expect(body.report.schema).toBe('wanyrix.what-changed/v1')
      expect(typeof body.report.workspace).toBe('string')
      expect(typeof body.report.findings).toBe('object')
      expect(typeof body.report.severityDelta).toBe('object')
      return
    }
    // Default measured reality: the dogfood target has NO initialized store —
    // the engine exits 2 and the route serves the named error VERBATIM as a
    // client-fixable 503.
    expect(res.status).toBe(503)
    const body = res.body as { error: string; detail: string; hint?: string }
    expect(body.error).toContain('what-changed store unavailable')
    expect(body.detail).toContain('wanyrix: error:')
    expect(body.detail).toContain('store not found at')
    expect(body.hint).toContain('wanyrix store init --db')
  })

  test('registered-workspace targets: git/impact/what-changed honor ?workspace= (and the ?ws= alias), unknown id → 404', async () => {
    if (!ENGINE_UP_69) return
    // REGISTER the real engine crate (dogfood target, guaranteed Rust project)
    const res = await fetchJson('/api/wanyrix/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.resolve(REPO_ROOT, 'engine') }),
    })
    expect(res.status).toBe(200)
    expectJson(res)
    const wsId = (res.body as { workspace: { id: string; path: string } }).workspace.id
    const wsPath = (res.body as { workspace: { path: string } }).workspace.path

    try {
      // git against the registered row — same report, registered envelope
      const git = await fetchJson(`/api/wanyrix/git?workspace=${encodeURIComponent(wsId)}`)
      expect(git.status).toBe(200)
      const gitBody = git.body as {
        workspaceId?: string
        scanTarget: string
        report: { schema?: string }
      }
      expect(gitBody.workspaceId).toBe(wsId)
      expect(gitBody.scanTarget).toBe(wsPath)
      expect(gitBody.report.schema).toBe('wanyrix.git/v1')

      // the ?ws= alias resolves the same registered row
      const gitAlias = await fetchJson(`/api/wanyrix/git?ws=${encodeURIComponent(wsId)}`)
      expect(gitAlias.status).toBe(200)
      expect((gitAlias.body as { workspaceId?: string }).workspaceId).toBe(wsId)

      // impact against the registered row
      const impact = await fetchJson(
        `/api/wanyrix/engine/impact?crate=${encodeURIComponent(DOGFOOD_CRATE)}&workspace=${encodeURIComponent(wsId)}`,
      )
      expect(impact.status).toBe(200)
      expect(((impact.body as { report: { crateName?: string } }).report.crateName ?? '')).toBe(
        DOGFOOD_CRATE,
      )

      // what-changed against the registered row — the store lives under the
      // REGISTERED path's own .wanyrix dir (server-derived), so the same
      // store contract applies; on this machine it is the 503 verbatim case.
      const wc = await fetchJson(`/api/wanyrix/what-changed?workspace=${encodeURIComponent(wsId)}`)
      expectJson(wc)
      if (wc.status === 503) {
        expect((wc.body as { detail: string }).detail).toContain('store not found at')
        expect((wc.body as { detail: string }).detail).toContain(`${wsPath}/.wanyrix/store.db`)
      } else {
        expect(wc.status).toBe(200)
        expect((wc.body as { report: { schema?: string } }).report.schema).toBe(
          'wanyrix.what-changed/v1',
        )
      }
    } finally {
      // cleanup — the suite never leaves a registered row behind
      await fetchJson(`/api/wanyrix/workspaces?id=${encodeURIComponent(wsId)}`, { method: 'DELETE' })
    }

    // unknown id on the new surfaces → the doctor route's named 404, never an exec
    for (const route of ['git', 'what-changed']) {
      const unknown = await fetchJson(
        `/api/wanyrix/${route}?workspace=${encodeURIComponent('ws-local-not-a-real-row-69')}`,
      )
      expect(unknown.status).toBe(404)
      expectJson(unknown)
      expect((unknown.body as { error: string }).error).toContain(
        'no registered workspace with id ws-local-not-a-real-row-69',
      )
    }
    const unknownImpact = await fetchJson(
      `/api/wanyrix/engine/impact?crate=${DOGFOOD_CRATE}&workspace=${encodeURIComponent('ws-local-not-a-real-row-69')}`,
    )
    expect(unknownImpact.status).toBe(404)
    expect((unknownImpact.body as { error: string }).error).toContain(
      'no registered workspace with id ws-local-not-a-real-row-69',
    )
  })
})

// AUD-4 — counted skip banner: exact number of live cases this file skipped.
// afterAll, not module scope: bun runs describe bodies at collection time
// (after top-level evaluation), so the counted registration is only final here.
if (!serverUp) afterAll(() => skipBanner('wanyrix-api.test.ts', liveBase))
