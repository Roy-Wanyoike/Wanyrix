/**
 * AUD-2 — route-level contract tests for the ONLY durable server write path.
 *
 * `POST/GET /api/wanyrix/scan-runs` (`wanyrix.scan-runs/v1`) is the product's
 * single server-persisted write (Prisma ScanRun) — until this file it had
 * ZERO route-level coverage (only the client localStorage store was
 * unit-tested). Pins, against the LIVE dev server:
 *
 *   happy:      POST → 201 envelope, verbatim GET round-trip, ?workspace=
 *               alias, idempotent re-POST (upsert — no duplicate row),
 *               fractional durationMs rounding, newest-first ordering;
 *   failures:   unknown workspace → 404 + knownWorkspaces (#129 contract),
 *               malformed JSON / non-object / bad fields → 400 (named),
 *               body > 64 KB → 413, wrong methods → 405 + Allow;
 *   R7 + #128:  findingIds fingerprint round-trip + cap refusal, replay
 *               marker round-trip;
 *   AUD-14:     a REGISTERED workspace id resolves (durable sync is no
 *               longer fixture-only) — capability-probed, because the
 *               shared dev server serves the MAIN checkout and still runs
 *               pre-merge code; the unknown-registered-shape 404 branch is
 *               pinned unconditionally (old and new code agree on it).
 *
 * Ids are QA-scoped (`run-aud2-…`/`run-aud14-…`) so runs never collide with
 * real syncs; the ScanRun log is append/upsert-only by design (no DELETE
 * route exists).
 */
import { beforeAll, describe, expect } from 'bun:test'

import { errorOf, expectJson, fetchJson, makeGatedTest, serverUp, test } from './harness'

const WS = 'helios-platform'
const NOW = () => Date.now()
const PATH = '/api/wanyrix/scan-runs'

function runBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const startedAt = NOW() - 5_000
  return {
    id: `run-aud2-${NOW()}-${Math.floor(Math.random() * 1e6)}`,
    workspaceId: WS,
    startedAt,
    finishedAt: startedAt + 1_234,
    findingCount: 3,
    severityCounts: { critical: 1, warning: 2, info: 0 },
    trigger: 'manual',
    ...overrides,
  }
}

let id: string

beforeAll(() => {
  id = `run-aud2-${NOW()}-${Math.floor(Math.random() * 1e6)}`
})

/* --------------------------------------------------------------- AUD-14 --
 * Capability probe for the registered-id resolution: the ids must come from
 * the SAME registry the workspaces route serves, and the POST must actually
 * resolve (201) — otherwise the server predates AUD-14 and the live pins
 * register as visible, counted SKIPS (never a vacuous green).
 * The probe id is FIXED (upsert ⇒ no duplicate rows) and QA-scoped. */
let registeredIds: string[] = []
let aud14Live = false
if (serverUp) {
  try {
    const registry = await fetchJson('/api/wanyrix/workspaces')
    registeredIds = ((registry.body as { registered?: { id: string }[] | null })?.registered ?? [])
      .map((r) => r.id)
      .filter((x) => typeof x === 'string')
    if (registeredIds.length > 0) {
      const probe = await fetchJson(PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(runBody({ id: 'run-aud14-probe', workspaceId: registeredIds[0] })),
      })
      aud14Live = probe.status === 201
    }
  } catch {
    // probe failures simply gate the AUD-14 live pins off — the harness
    // counts them as visible skips below
  }
}
const aud14Test = makeGatedTest(aud14Live)

describe('POST /api/wanyrix/scan-runs — the durable write (AUD-2)', () => {
  test('happy POST → 201 wanyrix.scan-runs/v1 envelope with the run echoed', async () => {
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runBody({ id })),
    })
    expect(res.status).toBe(201)
    expectJson(res)
    const body = res.body as { schema?: string; run?: Record<string, unknown> }
    expect(body.schema).toBe('wanyrix.scan-runs/v1')
    expect(body.run?.id).toBe(id)
    expect(body.run?.workspaceId).toBe(WS)
    expect(body.run?.findingCount).toBe(3)
  })

  test('idempotent upsert: re-POST of the SAME id → 201 and NO duplicate row', async () => {
    const again = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runBody({ id, findingCount: 4, severityCounts: { critical: 0, warning: 4, info: 0 } })),
    })
    expect(again.status).toBe(201)
    const list = await fetchJson(`${PATH}?ws=${WS}`)
    const runs = (list.body as { runs?: { id: string }[] })?.runs ?? []
    const same = runs.filter((r) => r.id === id)
    expect(same.length).toBe(1)
  })

  test('GET round-trip is verbatim: severityCounts, trigger, findingIds, replay marker', async () => {
    const fid = `run-aud2-fp-${NOW()}`
    await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        runBody({
          id: fid,
          findingIds: ['FER-BLD-001', 'FER-ENG-004'],
          replay: true,
          trigger: 'topbar',
        }),
      ),
    })
    const list = await fetchJson(`${PATH}?ws=${WS}`)
    const run = (list.body as { runs?: Record<string, unknown>[] })?.runs?.find(
      (r) => r.id === fid,
    )
    expect(run).toBeDefined()
    expect(run?.trigger).toBe('topbar')
    expect(run?.findingIds).toEqual(['FER-BLD-001', 'FER-ENG-004'])
    expect(run?.replay).toBe(true)
  })

  test('fractional durationMs is rounded to whole ms (stored honestly, no fabrication)', async () => {
    const fid = `run-aud2-frac-${NOW()}`
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runBody({ id: fid, durationMs: 1234.6 })),
    })
    expect(res.status).toBe(201)
    const run = (res.body as { run?: { durationMs?: number } })?.run
    expect(Number.isInteger(run?.durationMs)).toBe(true)
    expect(run?.durationMs).toBe(1235)
  })

  test('unknown workspace → 404 {error, knownWorkspaces} (#129 param contract)', async () => {
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runBody({ workspaceId: 'no-such-workspace' })),
    })
    expect(res.status).toBe(404)
    expectJson(res)
    expect(errorOf(res)).toContain('unknown workspace')
    const known = (res.body as { knownWorkspaces?: string[] })?.knownWorkspaces
    expect(Array.isArray(known)).toBe(true)
    expect(known?.length).toBeGreaterThan(0)
  })

  test('malformed JSON → 400 named reason', async () => {
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"id": broken',
    })
    expect(res.status).toBe(400)
    expect(errorOf(res)).toContain('malformed JSON')
  })

  test('non-object body (array) → 400', async () => {
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    })
    expect(res.status).toBe(400)
    expect(errorOf(res)).toContain('JSON object')
  })

  test('severityCounts must sum to findingCount → 400', async () => {
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runBody({ severityCounts: { critical: 1, warning: 1, info: 0 } })),
    })
    expect(res.status).toBe(400)
    expect(errorOf(res)).toContain('sum to findingCount')
  })

  test('unknown trigger → 400 naming the allowed set', async () => {
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runBody({ trigger: 'cron-of-doom' })),
    })
    expect(res.status).toBe(400)
    expect(errorOf(res)).toContain('trigger')
  })

  test('findingIds over the 400-entry cap → 400 naming the cap (R7 contract)', async () => {
    const tooMany = Array.from({ length: 401 }, (_, i) => `FER-X-${String(i).padStart(3, '0')}`)
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runBody({ findingIds: tooMany })),
    })
    expect(res.status).toBe(400)
    expect(errorOf(res)).toContain('400')
  })

  test('findingIdsTruncated non-boolean → 400', async () => {
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runBody({ findingIdsTruncated: 'yes' })),
    })
    expect(res.status).toBe(400)
    expect(errorOf(res)).toContain('boolean')
  })

  test('body > 64 KB → 413 (the documented cap)', async () => {
    const pad = 'x'.repeat(70 * 1024)
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runBody({ note: pad })),
    })
    expect(res.status).toBe(413)
    expect(errorOf(res)).toContain('too large')
  })
})

describe('GET /api/wanyrix/scan-runs', () => {
  test('list envelope: schema, workspace, count consistency, newest-first ordering', async () => {
    const res = await fetchJson(`${PATH}?ws=${WS}`)
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as {
      schema?: string
      workspace?: string
      count?: number
      runs?: { startedAt: number }[]
    }
    expect(body.schema).toBe('wanyrix.scan-runs/v1')
    expect(body.workspace).toBe(WS)
    expect(body.count).toBe((body.runs ?? []).length)
    const starts = (body.runs ?? []).map((r) => r.startedAt)
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i - 1]).toBeGreaterThanOrEqual(starts[i])
    }
  })

  test('?workspace= alias behaves identically to ?ws= (byte-identical envelope workspace field)', async () => {
    const a = await fetchJson(`${PATH}?ws=${WS}`)
    const b = await fetchJson(`${PATH}?workspace=${WS}`)
    expect(b.status).toBe(a.status)
    expect((b.body as { workspace?: string })?.workspace).toBe(
      (a.body as { workspace?: string })?.workspace,
    )
  })

  test('unknown workspace → 404 + knownWorkspaces', async () => {
    const res = await fetchJson(`${PATH}?ws=ghost-ws`)
    expect(res.status).toBe(404)
    expect(errorOf(res)).toContain('unknown workspace')
  })
})

describe('scan-runs method discipline', () => {
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    test(`${method} → 405 with Allow: GET, POST`, async () => {
      const res = await fetchJson(PATH, { method })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('GET, POST')
    })
  }
})

describe('AUD-14 — registered workspace ids resolve on scan-runs', () => {
  test('unknown REGISTERED-SHAPED id → 404 {error, knownWorkspaces} (branch old/new code agree on)', async () => {
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runBody({ workspaceId: 'ws-local-nobody-00000000' })),
    })
    expect(res.status).toBe(404)
    expect(errorOf(res)).toContain('unknown workspace')
    const known = (res.body as { knownWorkspaces?: string[] })?.knownWorkspaces
    expect(Array.isArray(known)).toBe(true)
    expect(known?.length).toBeGreaterThan(0)
  })

  aud14Test('POST with a REGISTERED id (from the workspaces registry) → 201', async () => {
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        runBody({ id: `run-aud14-${NOW()}`, workspaceId: registeredIds[0] }),
      ),
    })
    expect(res.status).toBe(201)
    expectJson(res)
    expect((res.body as { run?: { workspaceId?: string } })?.run?.workspaceId).toBe(
      registeredIds[0],
    )
  })

  aud14Test('GET ?ws=<registered id> → 200 envelope scoped to the registered id', async () => {
    const res = await fetchJson(`${PATH}?ws=${registeredIds[0]}`)
    expect(res.status).toBe(200)
    expectJson(res)
    const body = res.body as { schema?: string; workspace?: string; count?: number }
    expect(body.schema).toBe('wanyrix.scan-runs/v1')
    expect(body.workspace).toBe(registeredIds[0])
    expect(body.count).toBeGreaterThan(0)
  })

  aud14Test('unknown registered-shaped 404 lists the registered ids in knownWorkspaces', async () => {
    const res = await fetchJson(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runBody({ workspaceId: 'ws-local-nobody-00000000' })),
    })
    expect(res.status).toBe(404)
    const known = (res.body as { knownWorkspaces?: string[] })?.knownWorkspaces ?? []
    expect(known).toContain(registeredIds[0])
  })
})
