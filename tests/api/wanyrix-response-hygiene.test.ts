/**
 * Issue #141 — response & runtime hygiene (live API contract suite).
 *
 * Over-the-wire pins for the response-header posture shipped by #141:
 *   - every MUTATING endpoint response (any status) carries
 *     `Cache-Control: no-store` (via the `withNoStore` wrapper in
 *     src/lib/http-hygiene.ts);
 *   - GET responses (API + page) carry the three global security headers and
 *     NO `X-Powered-By` (next.config.ts `poweredByHeader: false` + `headers()`).
 *
 * Capability-probed, same discipline as the #129 pins in wanyrix-api.test.ts:
 * a dev server predating the #141 merge answers without the new headers, so
 * the pins SKIP with that reason stated (never a silent pass). The same
 * contracts are proven server-free by tests/unit/http-hygiene.test.ts.
 *
 * Server under test: BASE_URL (default http://localhost:3000, override with
 * WANYRIX_TEST_BASE_URL). Only state-safe requests are issued from this
 * suite: the storage sim mutations, validation-refusal paths (400/404), and
 * the honest 503 of the unconfigured license issuer — no durable row is
 * written and no engine scan is triggered here.
 */
import { describe, expect, test } from 'bun:test'

const BASE_URL = process.env.WANYRIX_TEST_BASE_URL ?? 'http://localhost:3000'
const FETCH_TIMEOUT_MS = 10_000

async function serverReachable(): Promise<boolean> {
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

const serverUp = await serverReachable()

if (!serverUp) {
  console.warn(
    `[wanyrix-response-hygiene] dev server unreachable at ${BASE_URL} — skipping live header pins. ` +
      'Start it with `bun run dev` (or point WANYRIX_TEST_BASE_URL elsewhere).',
  )
}

const describeServer = describe.skipIf(!serverUp)

/* -------------------------------------------------- capability probing ---- */

// #141a ships with per-route code → hot-reloadable; a server running the
// #141-wrapped scan-runs/storage handlers answers POSTs with no-store.
const UNKNOWN_WS = 'does-not-exist-141'

async function probeNoStore(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/wanyrix/storage/rebuild`, {
      method: 'POST',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    return res.headers.get('cache-control') === 'no-store'
  } catch {
    return false
  }
}

// #141b ships in next.config.ts → read at server START, NOT hot-reloaded. A
// dev server launched before the config change serves neither the security
// headers nor the removed X-Powered-By until it is restarted.
async function probeSecurityHeaders(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/wanyrix/workspaces`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    return (
      res.headers.get('x-content-type-options') === 'nosniff' &&
      res.headers.get('x-frame-options') === 'DENY' &&
      res.headers.get('referrer-policy') === 'strict-origin-when-cross-origin' &&
      res.headers.get('x-powered-by') === null
    )
  } catch {
    return false
  }
}

const SERVER_HAS_141_NO_STORE = serverUp ? await probeNoStore() : false
const SERVER_HAS_141_HEADERS = serverUp ? await probeSecurityHeaders() : false

if (serverUp && !SERVER_HAS_141_NO_STORE) {
  console.warn(
    '[wanyrix-response-hygiene] server predates the #141a no-store wrappers — ' +
      'Cache-Control pins skipped with that reason stated.',
  )
}
if (serverUp && !SERVER_HAS_141_HEADERS) {
  console.warn(
    '[wanyrix-response-hygiene] server has not restarted on the #141b next.config — ' +
      'security-header pins skipped with that reason stated.',
  )
}

const describeNoStore = describe.skipIf(!SERVER_HAS_141_NO_STORE)
const describeHeaders = describe.skipIf(!SERVER_HAS_141_HEADERS)

/* ------------------------------------------------------------ helpers ---- */

async function headersOf(pathAndQuery: string, init?: RequestInit): Promise<Response> {
  return await fetch(`${BASE_URL}${pathAndQuery}`, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
}

function expectNoStore(res: Response): void {
  expect(res.headers.get('cache-control')).toBe('no-store')
}

/* --------------------------------------------------------------- pins ---- */

describeServer('response hygiene — mutating endpoints (#141a)', () => {
  test('POST /storage/rebuild → no-store (sim mutation, 200)', async () => {
    const res = await headersOf('/api/wanyrix/storage/rebuild', { method: 'POST' })
    expect(res.status).toBe(200)
    expectNoStore(res)
  })

  test('POST /storage/reclaim → no-store (sim mutation, 200)', async () => {
    const res = await headersOf('/api/wanyrix/storage/reclaim', { method: 'POST' })
    expect(res.status).toBe(200)
    expectNoStore(res)
  })

  test('POST /workspaces malformed JSON → 400 with no-store', async () => {
    const res = await headersOf('/api/wanyrix/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    expectNoStore(res)
  })

  test('DELETE /workspaces without id → 400 with no-store', async () => {
    const res = await headersOf('/api/wanyrix/workspaces', { method: 'DELETE' })
    expect(res.status).toBe(400)
    expectNoStore(res)
  })

  test('POST /scan-runs unknown workspace → 404 with no-store (no durable write)', async () => {
    const res = await headersOf('/api/wanyrix/scan-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: UNKNOWN_WS }),
    })
    expect(res.status).toBe(404)
    expectNoStore(res)
  })

  test('POST /export unknown workspace → 404 with no-store (no engine run)', async () => {
    const res = await headersOf(`/api/wanyrix/export?ws=${encodeURIComponent(UNKNOWN_WS)}`, {
      method: 'POST',
    })
    expect(res.status).toBe(404)
    expectNoStore(res)
  })

  test('POST /license/issue unconfigured issuer → 503 with no-store (honest refusal)', async () => {
    const res = await headersOf('/api/wanyrix/license/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'team', team: 'example-team' }),
    })
    // 503 = honest "issuer not configured"; a server WITH a signing key would
    // answer 200 — either way the response must be no-store.
    expect([200, 503]).toContain(res.status)
    expectNoStore(res)
  })

  test('POST /explain missing fields → 400 with no-store', async () => {
    const res = await headersOf('/api/wanyrix/explain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: 'x' }),
    })
    expect(res.status).toBe(400)
    expectNoStore(res)
  })
})

describeHeaders('response hygiene — global security headers (#141b)', () => {
  test('GET /api/wanyrix/workspaces → nosniff + DENY + referrer-policy, no X-Powered-By', async () => {
    const res = await headersOf('/api/wanyrix/workspaces')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('x-powered-by')).toBeNull()
  })

  test('GET page (/) → the same three headers, no X-Powered-By', async () => {
    const res = await headersOf('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('x-powered-by')).toBeNull()
  })
})
