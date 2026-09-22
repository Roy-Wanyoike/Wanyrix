/**
 * Issue #129 — the unified workspace-param contract, proven WITHOUT the dev
 * server (direct handler invocation against the worktree source).
 *
 * The live-HTTP pins for the same contract live in
 * tests/api/wanyrix-api.test.ts (issue-#129 block, capability-probed): the
 * shared dev server serves the MAIN checkout, so pre-merge it still runs the
 * OLD param code and those pins would fail. This file imports the route
 * handlers directly — the logic is proven here the moment the branch exists,
 * and the live pins activate post-merge.
 *
 * Contract under test (ENG-TCA-1 + issue #129):
 *   - every fixture-scoped route accepts BOTH `?ws=` (canonical) and
 *     `?workspace=` (alias); `ws` wins when both are present;
 *   - an unknown id under EITHER spelling → 404
 *     `{ error: "unknown workspace '<id>'", knownWorkspaces: [...] }` —
 *     NEVER default-workspace data (the #129 bug: `health?workspace=x` used
 *     to return 200 with the default workspace's payload because only `ws`
 *     was read);
 *   - no route.ts under src/app/api/wanyrix reads the param inline — the
 *     reader is centralized in `workspaceParam` (src/lib/wanyrix/api.ts).
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'

import { resolveWorkspace, workspaceParam, WORKSPACE_IDS } from '../../src/lib/wanyrix/api'
import { WORKSPACES_DEFAULT } from '../../src/lib/wanyrix/data'
import { GET as healthGET } from '../../src/app/api/wanyrix/health/route'
import { GET as graphGET } from '../../src/app/api/wanyrix/graph/route'
import { GET as doctorGET } from '../../src/app/api/wanyrix/doctor/route'

const REPO_ROOT = path.resolve(import.meta.dir, '..', '..')
const API_DIR = path.join(REPO_ROOT, 'src', 'app', 'api', 'wanyrix')

const HELIOS = WORKSPACES_DEFAULT // first fixture id — 'helios-platform'
const ATLAS = WORKSPACE_IDS.find((id) => id !== HELIOS) ?? HELIOS // 'atlas-consortium'
const UNKNOWN = 'does-not-exist-129'

function req(url: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`)
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

/* ------------------------------------------------- the shared param reader -- */

describe('issue #129 — workspaceParam precedence', () => {
  test('both spellings present → `ws` wins (canonical, documented)', () => {
    const r = req(`/api/wanyrix/health?ws=${ATLAS}&workspace=${HELIOS}`)
    expect(workspaceParam(r)).toBe(ATLAS)
    expect(resolveWorkspace(r)).toEqual({ ws: ATLAS, error: null })
  })

  test('`?workspace=` alone resolves like `?ws=` alone', () => {
    expect(workspaceParam(req(`/api/wanyrix/health?workspace=${ATLAS}`))).toBe(ATLAS)
    expect(workspaceParam(req(`/api/wanyrix/health?ws=${ATLAS}`))).toBe(ATLAS)
    expect(resolveWorkspace(req(`/api/wanyrix/health?workspace=${ATLAS}`))).toEqual({
      ws: ATLAS,
      error: null,
    })
  })

  test('absent or empty under both spellings → registry default (unchanged)', async () => {
    expect(workspaceParam(req('/api/wanyrix/health'))).toBeNull()
    expect(resolveWorkspace(req('/api/wanyrix/health'))).toEqual({ ws: HELIOS, error: null })
    // present-but-empty (`?ws=&workspace=`) = absent at the handler level
    // (ENG-TCA-1 convention): the default workspace's data is served.
    const res = await healthGET(req('/api/wanyrix/health?ws=&workspace='))
    expect(res.status).toBe(200)
    expect((await jsonOf(res)).workspace).toBe(HELIOS)
  })
})

/* ---------------------- direct handler invocation — health (THE #129 bug) -- */

describe('issue #129 — health handler accepts both spellings', () => {
  test(`happy path: ?ws=${ATLAS} and ?workspace=${ATLAS} both echo the workspace`, async () => {
    for (const spelling of ['ws', 'workspace'] as const) {
      const res = await healthGET(req(`/api/wanyrix/health?${spelling}=${ATLAS}`))
      expect(res.status).toBe(200)
      expect((await jsonOf(res)).workspace).toBe(ATLAS)
    }
  })

  test(`BUG PIN: ?workspace=${UNKNOWN} → 404 envelope, no default-data leak`, async () => {
    // Pre-fix this returned 200 with the DEFAULT workspace's data (the
    // spelling was silently ignored) — a bogus workspace read as "healthy".
    const res = await healthGET(req(`/api/wanyrix/health?workspace=${UNKNOWN}`))
    expect(res.status).toBe(404)
    const body = await jsonOf(res)
    expect(body.error).toBe(`unknown workspace '${UNKNOWN}'`)
    expect(body.knownWorkspaces).toEqual(WORKSPACE_IDS)
    expect(body.workspace).toBeUndefined()
  })

  test(`?ws=${UNKNOWN} → the SAME 404 envelope (shape parity across spellings)`, async () => {
    const res = await healthGET(req(`/api/wanyrix/health?ws=${UNKNOWN}`))
    expect(res.status).toBe(404)
    const body = await jsonOf(res)
    expect(body.error).toBe(`unknown workspace '${UNKNOWN}'`)
    expect(body.knownWorkspaces).toEqual(WORKSPACE_IDS)
    expect(body.workspace).toBeUndefined()
  })

  test('both spellings on every known fixture id → 200', async () => {
    for (const id of WORKSPACE_IDS) {
      for (const spelling of ['ws', 'workspace'] as const) {
        const res = await healthGET(req(`/api/wanyrix/health?${spelling}=${id}`))
        expect(res.status).toBe(200)
        expect((await jsonOf(res)).workspace).toBe(id)
      }
    }
  })
})

/* ------------------- direct handler invocation — graph + doctor (1 other) -- */

describe('issue #129 — the ?workspace= alias works across the fixture-scoped family', () => {
  test(`graph?workspace=${ATLAS} → 200; graph?workspace=${UNKNOWN} → 404 envelope`, async () => {
    const ok = await graphGET(req(`/api/wanyrix/graph?workspace=${ATLAS}`))
    expect(ok.status).toBe(200)

    const bad = await graphGET(req(`/api/wanyrix/graph?workspace=${UNKNOWN}`))
    expect(bad.status).toBe(404)
    const body = await jsonOf(bad)
    expect(body.error).toBe(`unknown workspace '${UNKNOWN}'`)
    expect(body.knownWorkspaces).toEqual(WORKSPACE_IDS)
    expect(body.workspace).toBeUndefined()
  })

  test(`doctor?workspace=${ATLAS} → 200; doctor?workspace=${UNKNOWN} → 404 envelope`, async () => {
    const ok = await doctorGET(req(`/api/wanyrix/doctor?workspace=${ATLAS}`))
    expect(ok.status).toBe(200)
    expect((await jsonOf(ok)).workspace).toBe(ATLAS)

    const bad = await doctorGET(req(`/api/wanyrix/doctor?workspace=${UNKNOWN}`))
    expect(bad.status).toBe(404)
    const body = await jsonOf(bad)
    expect(body.error).toBe(`unknown workspace '${UNKNOWN}'`)
    expect(body.knownWorkspaces).toEqual(WORKSPACE_IDS)
  })
})

/* --------------------------- structural pin — no inline param reads remain -- */

describe('issue #129 — the param reader stays centralized', () => {
  const routeFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name)
      return e.isDirectory() ? routeFiles(full) : e.name === 'route.ts' ? [full] : []
    })

  test('no route.ts under src/app/api/wanyrix reads ws/workspace inline', () => {
    const files = routeFiles(API_DIR)
    expect(files.length).toBeGreaterThanOrEqual(23) // the audited surface
    const offenders = files.filter((f) =>
      /searchParams\.get\(\s*['"](?:ws|workspace)['"]\s*\)/.test(readFileSync(f, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
