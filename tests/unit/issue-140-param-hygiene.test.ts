/**
 * Issue #140 — phantom-workspace resolution + API param hygiene, proven
 * WITHOUT the dev server (direct handler invocation against the worktree
 * source; the live-HTTP pins live in tests/api/issue-140-param-hygiene.test.ts).
 *
 * The three #140 bug classes pinned here:
 *
 *   1. PHANTOM WORKSPACE — `?ws=` (empty string) bypassed `raw ?? default`
 *      (nullish ≠ falsy), so fixture routes served data under the bogus id
 *      `""` (`/experiments?ws=` → `{workspace:""}`, `/report?ws=` →
 *      `wanyrix-report--*.json`). Contract now: absent OR empty `ws`/
 *      `workspace` on every workspace-scoped route → the named 400
 *      `{ error, knownWorkspaces }` (same envelope family as the
 *      unknown-name 404). Verified on the shared helpers AND on 8 route
 *      handlers directly (>3 required by the acceptance criteria).
 *
 *   2. scan-runs 'undefined' — GET with no `ws` fell back to the default and
 *      `?ws=` queried a phantom `""`; POST `{}` answered 404
 *      `unknown workspace 'undefined'` (String(undefined) interpolation).
 *      Contract now: missing/empty id → named 400 (`workspaceId is required`
 *      on POST), never a 'undefined'/`""` lookup; unknown id stays 404.
 *
 *   3. crate argv hygiene — `?crate=` reached engine argv verbatim; bad
 *      values surfaced as 502 quoting an engine clap refusal. Contract now:
 *      the value must pass `^[A-Za-z0-9_-]+$` + no leading `-` + ≤64 chars
 *      BEFORE the spawn → clean named 400 otherwise (execFile args-array
 *      discipline is unchanged — this is input validation, not escaping).
 */
import { describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'

import {
  CRATE_PARAM_MAX_LENGTH,
  CRATE_PARAM_PATTERN,
  isValidCrateParam,
  resolveWorkspace,
  workspaceRequiredResponse,
  WORKSPACE_IDS,
} from '../../src/lib/wanyrix/api'
import { GET as healthGET } from '../../src/app/api/wanyrix/health/route'
import { GET as graphGET } from '../../src/app/api/wanyrix/graph/route'
import { GET as doctorGET } from '../../src/app/api/wanyrix/doctor/route'
import { GET as prGET } from '../../src/app/api/wanyrix/pr/route'
import { GET as experimentsGET } from '../../src/app/api/wanyrix/experiments/route'
import { GET as reportGET } from '../../src/app/api/wanyrix/report/route'
import { GET as diagnosticsGET } from '../../src/app/api/wanyrix/diagnostics/route'
import { GET as impactGET } from '../../src/app/api/wanyrix/impact/route'
import { GET as scanRunsGET, POST as scanRunsPOST } from '../../src/app/api/wanyrix/scan-runs/route'
import { GET as engineImpactGET } from '../../src/app/api/wanyrix/engine/impact/route'

function req(url: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`)
}

/** POST-shaped request with a JSON body (real NextRequest — the handler reads
 * content-length + req.json()). */
function req2(url: string, body: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

/* ------------- 1. empty/missing ws → named 400 on the fixture family ------ */

describe('issue #140 — empty/missing ws → named 400 on every workspace-scoped route', () => {
  // The acceptance criteria require ≥3 routes; the whole fixture family is
  // pinned (8 handlers). Each is invoked DIRECTLY — no server, no db (the
  // 400 short-circuits before any registry/db work).
  const FAMILY: [string, (r: NextRequest) => Promise<Response>][] = [
    ['health', healthGET],
    ['graph', graphGET],
    ['doctor', doctorGET],
    ['pr', prGET],
    ['experiments', experimentsGET],
    ['report?format=json', reportGET],
    ['diagnostics', diagnosticsGET],
    ['impact?type=add-dep&target=sqlx', impactGET],
  ]

  for (const [route, handler] of FAMILY) {
    const sep = route.includes('?') ? '&' : '?'

    test(`GET /api/wanyrix/${route}${sep}ws= (empty) → 400 {error, knownWorkspaces}`, async () => {
      const res = await handler(req(`/api/wanyrix/${route}${sep}ws=`))
      expect(res.status).toBe(400)
      const body = await jsonOf(res)
      expect(String(body.error)).toContain('workspace param is required')
      expect(body.knownWorkspaces).toEqual(WORKSPACE_IDS)
      // never a payload under the phantom id
      expect(body.workspace).toBeUndefined()
    })

    test(`GET /api/wanyrix/${route} (no param) → the SAME named 400`, async () => {
      const res = await handler(req(`/api/wanyrix/${route}`))
      expect(res.status).toBe(400)
      const body = await jsonOf(res)
      expect(String(body.error)).toContain('workspace param is required')
      expect(body.knownWorkspaces).toEqual(WORKSPACE_IDS)
    })

    test(`GET /api/wanyrix/${route}${sep}workspace= (empty alias) → the SAME named 400`, async () => {
      const res = await handler(req(`/api/wanyrix/${route}${sep}workspace=`))
      expect(res.status).toBe(400)
      const body = await jsonOf(res)
      expect(String(body.error)).toContain('workspace param is required')
    })
  }

  test('the 400 carries the same guidance envelope family as the unknown-name 404', async () => {
    const required = await jsonOf(workspaceRequiredResponse())
    expect(Object.keys(required).sort()).toEqual(['error', 'knownWorkspaces'])
    expect(Array.isArray(required.knownWorkspaces)).toBe(true)
    // resolveWorkspace exposes it as a pre-built error, never a resolved ws
    const resolved = resolveWorkspace(req('/api/wanyrix/health?ws='))
    expect(resolved.error?.status).toBe(400)
    expect(resolved.ws).toBe('')
  })

  test('known ids still resolve; unknown ids still 404 (no behavior change)', async () => {
    const known = resolveWorkspace(req(`/api/wanyrix/health?ws=${WORKSPACE_IDS[0]}`))
    expect(known).toEqual({ ws: WORKSPACE_IDS[0], error: null })

    const unknown = await healthGET(req('/api/wanyrix/health?ws=does-not-exist-140'))
    expect(unknown.status).toBe(404)
    const body = await jsonOf(unknown)
    expect(body.error).toBe("unknown workspace 'does-not-exist-140'")
    expect(body.knownWorkspaces).toEqual(WORKSPACE_IDS)
  })
})

/* ------------------- 2. scan-runs: missing id → named 400, never 'undefined' */

describe('issue #140 — scan-runs missing workspace → named 400 (never \'undefined\')', () => {
  test('GET with no ws → 400 named (was: silent default-workspace substitution)', async () => {
    const res = await scanRunsGET(req('/api/wanyrix/scan-runs'))
    expect(res.status).toBe(400)
    const body = await jsonOf(res)
    expect(String(body.error)).toContain('workspace param is required')
    expect(Array.isArray(body.knownWorkspaces)).toBe(true)
    expect(body.workspace).toBeUndefined()
  })

  test('GET ?ws= (empty) → 400 named (was: phantom "" DB query + workspace:"")', async () => {
    const res = await scanRunsGET(req('/api/wanyrix/scan-runs?ws='))
    expect(res.status).toBe(400)
    const body = await jsonOf(res)
    expect(String(body.error)).toContain('workspace param is required')
  })

  test('GET ?workspace= (empty alias) → the SAME 400', async () => {
    const res = await scanRunsGET(req('/api/wanyrix/scan-runs?workspace='))
    expect(res.status).toBe(400)
  })

  test('POST {} → 400 "workspaceId is required" (was: 404 unknown workspace \'undefined\')', async () => {
    const res = await scanRunsPOST(
      req2('/api/wanyrix/scan-runs', JSON.stringify({})),
    )
    expect(res.status).toBe(400)
    const body = await jsonOf(res)
    expect(String(body.error)).toContain('workspaceId is required')
    // the old noise never reappears
    expect(String(body.error)).not.toContain('undefined')
    expect(Array.isArray(body.knownWorkspaces)).toBe(true)
  })

  test('POST {workspaceId:""} (empty string) counts as missing → the SAME 400', async () => {
    const res = await scanRunsPOST(
      req2('/api/wanyrix/scan-runs', JSON.stringify({ workspaceId: '' })),
    )
    expect(res.status).toBe(400)
    expect(String((await jsonOf(res)).error)).toContain('workspaceId is required')
  })

  test('POST with a provided-but-unknown id keeps the #129 404 shape (not 400)', async () => {
    const res = await scanRunsPOST(
      req2(
        '/api/wanyrix/scan-runs',
        JSON.stringify({
          workspaceId: 'ghost-ws-140',
          startedAt: 1,
          finishedAt: 2,
          findingCount: 0,
          severityCounts: { critical: 0, warning: 0, info: 0 },
        }),
      ),
    )
    expect(res.status).toBe(404)
    const body = await jsonOf(res)
    expect(body.error).toBe("unknown workspace 'ghost-ws-140'")
    expect(Array.isArray(body.knownWorkspaces)).toBe(true)
  })
})

/* ----------------------------- 3. crate param hygiene (engine argv input) -- */

describe('issue #140 — crate param validated before it reaches engine argv', () => {
  test('allowlist constants: ^[A-Za-z0-9_-]+$, flag-guard, ≤64 chars', () => {
    expect(CRATE_PARAM_PATTERN.source).toBe('^[A-Za-z0-9_-]+$')
    expect(CRATE_PARAM_MAX_LENGTH).toBe(64)
  })

  test('valid crate names pass (letters, digits, -, _, 64-char boundary)', () => {
    for (const ok of ['wanyrix-engine', 'a-b_c9', 'A', '0crate', 'x'.repeat(64)]) {
      expect(isValidCrateParam(ok)).toBe(true)
    }
  })

  test('bad crate values fail: empty, --version, a b, unicode, 10k chars, junk', () => {
    for (const bad of [
      '',
      '   ',
      '--version',
      '-x',
      'a b',
      'крейт',
      'a'.repeat(10_000), // charset-valid but over the 64-char cap → 400
      '$(id)',
      '../../etc/passwd',
      'a;b',
      'a\tb',
    ]) {
      expect(isValidCrateParam(bad)).toBe(false)
    }
  })

  // Handler-level pins: the refusals short-circuit BEFORE probeBinary/spawn,
  // so these run server-free and never execute the engine.
  const BAD_CRATES: [string, string][] = [
    ['--version', '--version'],
    ['-x', '-x'],
    ['a b', 'a b'],
    ['крейт', 'крейт'],
    ['a'.repeat(10_000), 'a'.repeat(10_000)],
    ['$(id)', '$(id)'],
  ]

  for (const [label, value] of BAD_CRATES) {
    test(`engine/impact?crate=<${label}> → clean 400 (never 502 engine noise)`, async () => {
      const res = await engineImpactGET(req(`/api/wanyrix/engine/impact?crate=${encodeURIComponent(value)}`))
      expect(res.status).toBe(400)
      const body = await jsonOf(res)
      expect(String(body.error)).toContain('invalid crate')
      expect(String(body.error)).not.toContain('engine exited')
    })
  }

  test('engine/impact with no crate → the pre-existing missing-param 400', async () => {
    const res = await engineImpactGET(req('/api/wanyrix/engine/impact'))
    expect(res.status).toBe(400)
    expect(String((await jsonOf(res)).error)).toContain("missing required param 'crate'")
  })

  test('engine/impact with an EMPTY crate → missing-param 400 (empty = missing)', async () => {
    const res = await engineImpactGET(req('/api/wanyrix/engine/impact?crate='))
    expect(res.status).toBe(400)
    expect(String((await jsonOf(res)).error)).toContain("missing required param 'crate'")
  })
})
