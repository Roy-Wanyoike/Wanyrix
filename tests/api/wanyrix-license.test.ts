/**
 * Issue #94 E1 — sandbox license issuance over HTTP (live contract suite).
 *
 * Live contract suite for POST /api/wanyrix/license/issue, following the
 * conventions of wanyrix-api.test.ts / wanyrix-export.test.ts: the route
 * wraps the REAL `wanyrix license issue` binary and returns the signed
 * token verbatim plus the honesty label.
 *
 * Pinned here (license-specific):
 *   - method guards: GET/PUT/DELETE/PATCH → 405 with `Allow: POST` (ENG-TCA-6a);
 *   - unknown license paths (e.g. /api/wanyrix/license/renew) → 404 — there
 *     is no renewal until a payment backend exists and none is faked;
 *   - request validation: unknown plan / bad team / bad seats → named 400;
 *   - the honesty fork: with no `WANYRIX_SIGNING_KEY` configured the route
 *     answers an honest 503 (issuance is never simulated); when the operator
 *     configured the dev signing key, a valid request returns 200 with the
 *     verbatim `wanyrix.entitlement.token/v1` token + `honesty.label =
 *     "estimated"` — and the trial plan is pinned to EXACTLY 14 days;
 *   - optional E1→E2 round trip: when the dev-server launcher minted a dev
 *     keypair (public half at /tmp/wanyrix-94-dev-keys/) and the engine
 *     binary is built, the issued token is verified by the REAL
 *     `wanyrix activate` binary (offline, WANYRIX_ACTIVATION_PUBKEY
 *     override) — the same journey the issue demands. Skips honestly when
 *     the fixtures are absent.
 *
 * CWD-independent (see wanyrix-api.test.ts header): run from anywhere, e.g.
 * `cd tests && WANYRIX_TEST_BASE_URL=http://localhost:3457 bun test`. Skips
 * honestly when the dev server is down.
 */
import { afterAll, describe, expect } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
// AUD-4: test registration goes through the shared harness — counted, visibly
// skipped when the dev server is absent, and a hard failure under
// WANYRIX_REQUIRE_LIVE=1 (see tests/api/server-present.test.ts).
import { BASE_URL, liveTestCount, makeGatedTest, serverUp, skipBanner, test } from './harness'

const FETCH_TIMEOUT_MS = 10_000
// Registration baseline for this file's counted skip banner.
const liveBase = liveTestCount()

// CWD-independent repo root.
const REPO_ROOT = path.resolve(import.meta.dir, '..', '..')

/** Dev-key fixtures written by the launcher (mint-and-run.sh / manual setup). */
const DEV_KEYS_DIR = '/tmp/wanyrix-94-dev-keys'
const DEV_PUB_FILE = path.join(DEV_KEYS_DIR, 'wanyrix-license-pub.hex')

/* ------------------------------------------------------------- plumbing ---- */

interface JsonResponse {
  status: number
  contentType: string
  body: unknown
  headers: Headers
}

async function fetchJson(pathName: string, init?: RequestInit): Promise<JsonResponse> {
  const res = await fetch(`${BASE_URL}${pathName}`, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const contentType = res.headers.get('content-type') ?? ''
  let body: unknown = null
  if (contentType.includes('application/json')) {
    try {
      body = await res.json()
    } catch {
      body = null
    }
  }
  return { status: res.status, contentType, body, headers: res.headers }
}

/* ------------------------------------------------- server-dependent setup -- */

// serverUp comes from ./harness — probed once per run and shared by every
// suite file in the process. The guard lives in the per-test registration
// (harness `test`), so skipped cases stay counted and visible (AUD-4).
const describeServer = describe

describeServer('license issue route — method guards', () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    test(`${method} /api/wanyrix/license/issue → 405 with Allow: POST`, async () => {
      const res = await fetchJson('/api/wanyrix/license/issue', { method })
      expect(res.status).toBe(405)
      expect(res.headers.get('Allow')).toBe('POST')
      expect(res.body).not.toBeNull()
      expect(String((res.body as Record<string, unknown>).error)).toContain('method not allowed')
    })
  }
})

describeServer('license issue route — 404 for unknown license paths', () => {
  test('POST /api/wanyrix/license/renew → 404 (no renewal until a payment backend exists)', async () => {
    const res = await fetchJson('/api/wanyrix/license/renew', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'team', team: 'acme' }),
    })
    expect(res.status).toBe(404)
  })
})

describeServer('license issue route — request validation (named 400s)', () => {
  test('non-JSON body → 400', async () => {
    const res = await fetchJson('/api/wanyrix/license/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json at all',
    })
    expect(res.status).toBe(400)
    expect(String((res.body as Record<string, unknown>).error)).toContain('not valid JSON')
  })

  test("plan: 'free' → 400 (the free tier needs no license — never issued)", async () => {
    const res = await fetchJson('/api/wanyrix/license/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'free', team: 'acme' }),
    })
    expect(res.status).toBe(400)
    const err = String((res.body as Record<string, unknown>).error)
    expect(err).toContain('unknown plan')
    expect(err).toContain('never issued')
  })

  test("plan: 'enterprise' → 400 (issued by the on-prem server, not the sandbox)", async () => {
    const res = await fetchJson('/api/wanyrix/license/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'enterprise', team: 'acme' }),
    })
    expect(res.status).toBe(400)
  })

  test('missing team → 400', async () => {
    const res = await fetchJson('/api/wanyrix/license/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'team' }),
    })
    expect(res.status).toBe(400)
    expect(String((res.body as Record<string, unknown>).error)).toContain('team must be')
  })

  test('team with path-shaped junk → 400', async () => {
    const res = await fetchJson('/api/wanyrix/license/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'team', team: '../../etc/passwd' }),
    })
    expect(res.status).toBe(400)
  })

  test('seats: 0 → 400', async () => {
    const res = await fetchJson('/api/wanyrix/license/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'team', team: 'acme', seats: 0 }),
    })
    expect(res.status).toBe(400)
    expect(String((res.body as Record<string, unknown>).error)).toContain('seats must be')
  })
})

interface IssuedBody {
  schema: string
  token: Record<string, unknown>
  honesty: { label: string; note: string; kind: string }
  activation: { hint: string; network: string }
  binary: { version: string; profile: string }
}

/**
 * Issue one token over the wire and return either the 200 body or the
 * honest 503 body — the suite pins BOTH forks truthfully (which one runs
 * depends on whether the dev server was started with WANYRIX_SIGNING_KEY).
 */
async function issueToken(plan: 'team' | 'trial'): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetchJson('/api/wanyrix/license/issue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan, team: 'acme' }),
  })
  return { status: res.status, body: res.body as Record<string, unknown> }
}

describeServer('license issue route — the honest fork (503 unconfigured / 200 issued)', () => {
  test("POST { plan: 'trial', team: 'acme' } → honest 503 OR a real 14-day token", async () => {
    const { status, body } = await issueToken('trial')
    expect([200, 503]).toContain(status)

    if (status === 503) {
      // Issuer not configured on this server — the refusal must be honest
      // and name the missing configuration; no token may be fabricated.
      expect(String(body.error)).toContain('WANYRIX_SIGNING_KEY')
      expect(String(body.error)).toContain('never simulated')
      expect(body.env).toBe('WANYRIX_SIGNING_KEY')
      expect(body.token).toBeUndefined()
      return
    }

    const issued = body as unknown as IssuedBody
    expect(issued.schema).toBe('wanyrix.license-issue/v1')
    expect(issued.token.schema).toBe('wanyrix.entitlement.token/v1')
    expect(issued.token.plan).toBe('team')
    expect(issued.token.team).toBe('acme')
    expect(issued.honesty.label).toBe('estimated')
    expect(issued.honesty.kind).toBe('trial')
    expect(String(issued.honesty.note)).toContain('No payment method')
    expect(String(issued.activation.hint)).toContain('wanyrix activate --key')
    // THE trial pin: exactly 14 days (engine day-count semantics).
    expect((issued.token.expiryDay as number) - (issued.token.issuedAtDay as number)).toBe(14)
    expect(issued.token.signature).toMatch(/^[0-9a-f]{128}$/)
  })

  test("POST { plan: 'team', team: 'acme' } → honest 503 OR a 365-day token labeled estimated", async () => {
    const { status, body } = await issueToken('team')
    expect([200, 503]).toContain(status)
    if (status === 503) {
      expect(String(body.error)).toContain('WANYRIX_SIGNING_KEY')
      return
    }
    const issued = body as unknown as IssuedBody
    expect(issued.token.schema).toBe('wanyrix.entitlement.token/v1')
    expect((issued.token.expiryDay as number) - (issued.token.issuedAtDay as number)).toBe(365)
    expect(issued.honesty.label).toBe('estimated')
    expect(issued.honesty.kind).toBe('paid-tier-sandbox')
    expect(issued.binary.version).toMatch(/^wanyrix/)
  })
})

/* --------------------------------- optional E1→E2 round trip via the binary -- */

const engineBinary = ['release', 'debug']
  .map((profile) => path.join(REPO_ROOT, 'engine', 'target', profile, 'wanyrix'))
  .find((file) => existsSync(file))
const pubAvailable = existsSync(DEV_PUB_FILE)

if (serverUp && !pubAvailable) {
  console.warn(
    `[wanyrix-license] ${DEV_PUB_FILE} absent — skipping the activate round-trip (start the dev ` +
      'server with a keypair minted into /tmp/wanyrix-94-dev-keys to enable it).',
  )
}
if (serverUp && !engineBinary) {
  console.warn('[wanyrix-license] engine binary not built — skipping the activate round-trip.')
}

const describeRoundTrip = describe
const testRoundTrip = makeGatedTest(Boolean(serverUp && pubAvailable && engineBinary))

describeRoundTrip('license issue route — issued token verifies OFFLINE (E1→E2 round trip)', () => {
  testRoundTrip('wanyrix activate accepts the web-issued token and reports an active team entitlement', async () => {
    const { status, body } = await issueToken('trial')
    expect(status).toBe(200)
    const token = (body as unknown as IssuedBody).token

    const workDir = mkdtempSync(path.join(tmpdir(), 'wanyrix-license-live-'))
    const tokenFile = path.join(workDir, 'token.json')
    writeFileSync(tokenFile, JSON.stringify(token), { mode: 0o600 })
    try {
      const pubHex = (await Bun.file(DEV_PUB_FILE).text()).trim()
      const proc = Bun.spawnSync([engineBinary!, 'activate', '--key', tokenFile], {
        cwd: workDir, // the engine caches .wanyrix/entitlement.json HERE — never in the repo
        env: { ...process.env, WANYRIX_ACTIVATION_PUBKEY: pubHex },
      })
      const stdout = proc.stdout.toString()
      expect(proc.exitCode).toBe(0)
      expect(stdout).toContain('status: active')
      expect(stdout).toContain('plan: team')
      expect(stdout).toContain('zero network I/O')
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})

// AUD-4 — counted skip banner: exact number of live cases this file skipped.
// afterAll, not module scope: bun runs describe bodies at collection time
// (after top-level evaluation), so the counted registration is only final here.
if (!serverUp) afterAll(() => skipBanner('wanyrix-license.test.ts', liveBase))
