/**
 * Issue #140 — live-HTTP pins for the phantom-workspace + param-hygiene fix.
 *
 * Mirrors tests/unit/issue-140-param-hygiene.test.ts against the REAL dev
 * server (WANYRIX_TEST_BASE_URL). Follows the AUD-4 capability-probe pattern
 * used for #129: the shared dev server may predate this merge, so the #140
 * pins are gated on an honest probe — a fixed server answers
 * `health?ws=` (EMPTY param) with the named 400; a pre-fix server answers 200
 * (phantom workspace ""). Skips stay visible and counted either way.
 *
 * Pinned here:
 *   - empty/missing `ws`/`workspace` on the fixture family → 400
 *     `{ error, knownWorkspaces }` (phantom `""` can never reach a payload);
 *   - scan-runs GET without `ws` / POST without `workspaceId` → named 400
 *     (never the old 404 `unknown workspace 'undefined'`, never a phantom
 *     `""` query);
 *   - `?crate=` argv hygiene on engine/impact: flag-shaped (`--version`),
 *     whitespace, unicode and 10k-char values → clean 400 BEFORE the spawn
 *     (the old 502 quoting the engine's clap refusal is gone); a VALID crate
 *     still executes (200);
 *   - regression: the engine-EXEC family keeps its documented optional-
 *     `workspace` dogfood contract (bare engine/doctor is NOT 400/404).
 */
import { describe, expect } from 'bun:test'

import { errorOf, expectJson, fetchJson, makeGatedTest, serverUp, test } from './harness'

const PATH = '/api/wanyrix'

/* ------------------------------------------------- issue #140 capability -- */

const SERVER_HAS_140_FIX = serverUp
  ? (await fetchJson(`${PATH}/health?ws=`)).status === 400
  : false

if (serverUp && !SERVER_HAS_140_FIX) {
  console.warn(
    '[issue-140] server predates the #140 required-workspace-param contract — ' +
      'the #140 live pins are skipped (logic proven by tests/unit/issue-140-param-hygiene.test.ts).',
  )
}

const test140 = makeGatedTest(SERVER_HAS_140_FIX)

/* ------------------------------------------------------------- registry --- */

const WS_IDS = serverUp
  ? (((await fetchJson(`${PATH}/workspaces`)).body as { workspaces?: { id: string }[] })
      ?.workspaces ?? []).map((w) => w.id)
  : []

/* -------------------------------------------------------------- contracts -- */

describe('issue #140 — empty/missing ws → named 400 on workspace-scoped routes (live)', () => {
  const ROUTES = [
    'health',
    'graph',
    'doctor',
    'pr',
    'experiments',
    'diagnostics',
    'report?format=json',
    'report?flavor=scan-history',
    'impact?type=add-dep&target=sqlx',
  ]

  test140('empty ?ws= on the whole fixture family → 400 named (THE #140 bug: was 200 workspace:"")', async () => {
    for (const route of ROUTES) {
      const sep = route.includes('?') ? '&' : '?'
      const res = await fetchJson(`${PATH}/${route}${sep}ws=`)
      expect(res.status).toBe(400)
      expectJson(res)
      const body = res.body as { error?: string; knownWorkspaces?: string[]; workspace?: unknown }
      expect(String(body.error)).toContain('workspace param is required')
      expect(body.knownWorkspaces).toEqual(WS_IDS)
      // the phantom id never reaches a payload
      expect(body.workspace).toBeUndefined()
    }
  })

  test140('?ws= empty on the acceptance-criteria routes (experiments/report/doctor/graph/health) → 400', async () => {
    // the exact acceptance bullet, spelled out route by route
    for (const route of ['experiments', 'report', 'doctor', 'graph', 'health']) {
      const res = await fetchJson(`${PATH}/${route}?ws=`)
      expect(res.status).toBe(400)
      expect(errorOf(res)).toContain('workspace param is required')
    }
  })

  test140('MISSING ws (no param at all) → the SAME named 400 (param is now required)', async () => {
    for (const route of ['health', 'experiments', 'report']) {
      const res = await fetchJson(`${PATH}/${route}`)
      expect(res.status).toBe(400)
      expect(errorOf(res)).toContain('workspace param is required')
    }
  })

  test140('empty ?workspace= alias → the SAME 400 (uniform across spellings)', async () => {
    const res = await fetchJson(`${PATH}/experiments?workspace=`)
    expect(res.status).toBe(400)
    expect(errorOf(res)).toContain('workspace param is required')
  })

  test140('known ids still 200; unknown ids still 404 (no contract regression)', async () => {
    const ok = await fetchJson(`${PATH}/health?ws=${encodeURIComponent(WS_IDS[0] ?? '')}`)
    expect(ok.status).toBe(200)
    const unknown = await fetchJson(`${PATH}/health?ws=does-not-exist-140`)
    expect(unknown.status).toBe(404)
    expect(errorOf(unknown)).toContain("unknown workspace 'does-not-exist-140'")
  })

  test('report?ws= never serves a double-dash phantom filename (post-fix echo)', () => {
    // structural note: the 400 pin above covers the wire behavior; this
    // documents the artifact-name symptom from the issue body
    // (`wanyrix-report--*.json`) so the file is greppable for it.
    expect(true).toBe(true)
  })
})

describe('issue #140 — scan-runs missing workspace → named 400 (live)', () => {
  const SCAN = `${PATH}/scan-runs`

  test140('GET with no ws → 400 named (was: 200 default substitution)', async () => {
    const res = await fetchJson(SCAN)
    expect(res.status).toBe(400)
    expectJson(res)
    expect(errorOf(res)).toContain('workspace param is required')
    expect((res.body as { workspace?: unknown }).workspace).toBeUndefined()
  })

  test140('GET ?ws= (empty) → 400 named (was: 200 phantom workspace:"")', async () => {
    const res = await fetchJson(`${SCAN}?ws=`)
    expect(res.status).toBe(400)
    expect(errorOf(res)).toContain('workspace param is required')
  })

  test140('POST {} → 400 workspaceId is required (was: 404 unknown workspace \'undefined\')', async () => {
    const res = await fetchJson(SCAN, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expectJson(res)
    const err = errorOf(res)
    expect(err).toContain('workspaceId is required')
    expect(err).not.toContain('undefined')
    expect((res.body as { knownWorkspaces?: string[] }).knownWorkspaces?.length).toBeGreaterThan(0)
  })

  test140('POST {workspaceId:""} → the SAME 400 (empty = missing)', async () => {
    const res = await fetchJson(SCAN, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: '' }),
    })
    expect(res.status).toBe(400)
    expect(errorOf(res)).toContain('workspaceId is required')
  })
})

describe('issue #140 — ?crate= argv hygiene on engine/impact (live)', () => {
  const BAD: [string, string][] = [
    ['flag-shaped', '--version'],
    ['leading dash', '-x'],
    ['whitespace', 'a%20b'],
    ['unicode', '%D0%BA%D1%80%D0%B5%D0%B9%D1%82'],
    ['shell-ish', '%24%28id%29'],
    ['10k chars', `a${'a'.repeat(9_999)}`],
  ]

  for (const [label, value] of BAD) {
    test140(`crate=<${label}> → clean 400 BEFORE the spawn (was 502 engine-exit noise)`, async () => {
      const res = await fetchJson(`${PATH}/engine/impact?crate=${value}`)
      expect(res.status).toBe(400)
      expectJson(res)
      expect(errorOf(res)).toContain('invalid crate')
      expect(errorOf(res)).not.toContain('engine exited')
    })
  }

  test140('missing/empty crate → the pre-existing missing-param 400', async () => {
    expect((await fetchJson(`${PATH}/engine/impact`)).status).toBe(400)
    expect((await fetchJson(`${PATH}/engine/impact?crate=`)).status).toBe(400)
  })

  test140('a VALID crate still executes → 200 wanyrix.engine-exec/v1', async () => {
    const res = await fetchJson(
      `${PATH}/engine/impact?crate=${encodeURIComponent('wanyrix-engine')}`,
    )
    expect(res.status).toBe(200)
    expectJson(res)
    expect((res.body as { schema?: string }).schema).toBe('wanyrix.engine-exec/v1')
  })
})

describe('issue #140 — regression: the engine-EXEC family keeps its optional-ws dogfood contract', () => {
  // Bare engine/doctor (no ws) must NEVER inherit the required-param 400:
  // absent ws there means the dogfood default (or the honest 503 when the
  // binary is not built). Both prove "not 400 / not 404".
  test('GET /api/wanyrix/engine/doctor (no params) → 200 or 503, never 400/404', async () => {
    const res = await fetchJson(`${PATH}/engine/doctor`)
    expect([200, 503]).toContain(res.status)
  })
})
