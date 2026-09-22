/**
 * Issue #91 — `wanyrix export` over HTTP (artifacts-as-code, team L1).
 *
 * Live contract suite for POST /api/wanyrix/export, following the same
 * conventions as the issue-#69 block in wanyrix-api.test.ts (which stays
 * the home of the shared 405/404 hygiene pins): the route spawns the REAL
 * `wanyrix` binary and returns the `wanyrix.export/v1` manifest verbatim
 * inside the `wanyrix.engine-exec/v1` wrapper.
 *
 * Pinned here (export-specific):
 *   - the manifest envelope shape: schema/engine/workspace/artifacts
 *     (file · wanyrix.* schema · bytes · sha256) + the honesty note —
 *     and NO wall-clock timestamp key anywhere;
 *   - the sha256 digests actually bind the artifact FILES the engine
 *     wrote under the dogfood target's `.wanyrix/exports` (cross-checked
 *     with node:crypto against the bytes on disk — artifacts-as-code
 *     means the manifest is verifiable, not decorative);
 *   - byte-identical repeat exports: two POSTs produce deep-equal
 *     manifests (same digests), the #91 acceptance criterion;
 *   - POST-only method guard with `Allow: POST` and the family's 404 for
 *     unknown workspace ids.
 *
 * CWD-independent (see wanyrix-api.test.ts header): run from anywhere,
 * e.g. `cd tests && bun test api/wanyrix-export.test.ts`. Skips honestly
 * when the dev server (WANYRIX_TEST_BASE_URL, default :3000) is down.
 */
import { afterAll, describe, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
// AUD-4: test registration goes through the shared harness — counted, visibly
// skipped when the dev server is absent, and a hard failure under
// WANYRIX_REQUIRE_LIVE=1 (see tests/api/server-present.test.ts).
import { BASE_URL, liveTestCount, serverUp, skipBanner, test } from './harness'

const FETCH_TIMEOUT_MS = 10_000
// Registration baseline for this file's counted skip banner.
const liveBase = liveTestCount()

// CWD-independent repo root (the suite must pass from any invocation dir).
const REPO_ROOT = path.resolve(import.meta.dir, '..', '..')

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

// serverUp comes from ./harness — probed once per run and shared by every
// suite file in the process. The guard lives in the per-test registration
// (harness `test`), so skipped cases stay counted and visible (AUD-4).
const describeServer = describe

interface ExportArtifactDto {
  file: string
  schema: string
  bytes: number
  sha256: string
}

interface ExportManifestDto {
  schema: string
  engine: string
  workspace: string
  excludes?: string[]
  artifacts: ExportArtifactDto[]
  measurement: string
}

interface ExportRouteBody {
  schema: string
  surface: string
  executedAt: string
  durationMs: number
  binary: { version: string; profile: string }
  scanTarget: string
  note: string
  report: ExportManifestDto
}

describeServer('Wanyrix API — artifacts-as-code export (issue #91)', () => {
  // One real-exec probe decides whether the binary-exec paths can run at
  // all (same discipline as the #69 block: the 503 checked-list shape is
  // shared with the whole engine-exec family). Memoized so every test
  // observes the same probe result; awaited lazily INSIDE each test
  // (describe callbacks are sync — no top-level await allowed there).
  let probePromise: Promise<JsonResponse | null> | null = null
  const probeOnce = (): Promise<JsonResponse | null> => {
    probePromise ??= serverUp
      ? fetchJson('/api/wanyrix/export', { method: 'POST' })
      : Promise.resolve(null)
    return probePromise
  }
  const engineUp = (probe: JsonResponse | null): probe is JsonResponse =>
    probe !== null && probe.status === 200

  test('POST /api/wanyrix/export → 200 engine-exec wrapper around a verbatim wanyrix.export/v1 manifest', async () => {
    const probe = await probeOnce()
    if (probe === null) {
      // The suite is skipped when the server is down, so a null probe here
      // means it died mid-run: fail loudly instead of asserting on nothing.
      throw new Error('[wanyrix-export] dev server became unreachable mid-suite')
    }
    expectJson(probe)
    if (probe.status !== 200) {
      // No engine binary on this machine → the honest 503 with the checked list.
      expect(probe.status).toBe(503)
      const body = probe.body as { error: string; checked: string[]; hint: string }
      expect(body.error).toContain('engine binary not found')
      expect(Array.isArray(body.checked)).toBe(true)
      expect(body.hint).toContain('cargo build --locked')
      return
    }
    expect(probe.status).toBe(200)
    const body = probe.body as ExportRouteBody
    expect(body.schema).toBe('wanyrix.engine-exec/v1')
    expect(body.surface).toBe('export')
    expect(body.binary.version.length).toBeGreaterThan(0)
    expect(['debug', 'release']).toContain(body.binary.profile)
    expect(body.note).toContain('Verbatim stdout of the real wanyrix binary')

    // The engine's own manifest, byte-preserved.
    const manifest = body.report
    expect(manifest.schema).toBe('wanyrix.export/v1')
    expect(manifest.engine.length).toBeGreaterThan(0)
    expect(typeof manifest.workspace).toBe('string')
    expect(manifest.workspace.length).toBeGreaterThan(0)
    expect(manifest.measurement).toContain('byte-identical')
    // NO wall-clock timestamp KEYS anywhere in the manifest object graph
    // (issue #91). The honesty NOTE may mention the field names in prose —
    // the contract bans the keys, not the documentation of the ban.
    const collectKeys = (value: unknown, acc: string[] = []): string[] => {
      if (Array.isArray(value)) {
        for (const item of value) collectKeys(item, acc)
      } else if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          acc.push(k)
          collectKeys(v, acc)
        }
      }
      return acc
    }
    const manifestKeys = collectKeys(manifest)
    expect(manifestKeys).not.toContain('generatedAt')
    expect(manifestKeys).not.toContain('executedAt')
    expect(manifestKeys).not.toContain('lastScan')
  })

  test('the manifest digests bind the artifact files the engine wrote on disk', async () => {
    const probe = await probeOnce()
    if (!engineUp(probe)) return
    const body = probe.body as ExportRouteBody
    const exportsDir = path.join(REPO_ROOT, 'engine', '.wanyrix', 'exports')
    expect(fs.existsSync(exportsDir)).toBe(true)

    const files = body.report.artifacts.map((a) => a.file)
    expect(files).toEqual(['doctor.json', 'graph.json', 'health.json'])

    for (const artifact of body.report.artifacts) {
      expect(artifact.schema.startsWith('wanyrix.')).toBe(true)
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/)
      const onDisk = fs.readFileSync(path.join(exportsDir, artifact.file))
      expect(onDisk.length).toBe(artifact.bytes)
      expect(createHash('sha256').update(onDisk).digest('hex')).toBe(artifact.sha256)
      // Each artifact IS the versioned envelope it claims to be.
      const parsed = JSON.parse(onDisk.toString('utf8')) as { schema?: string; generatedAt?: string }
      expect(parsed.schema).toBe(artifact.schema)
      // Clock-free artifacts: the only stamp is the honest literal.
      expect(parsed.generatedAt).toBe('not-measured')
    }
    // The manifest itself is an artifact too — and self-describing.
    const indexRaw = fs.readFileSync(path.join(exportsDir, 'index.json'), 'utf8')
    const index = JSON.parse(indexRaw) as ExportManifestDto
    expect(index.schema).toBe('wanyrix.export/v1')
    expect(index.artifacts.length).toBe(3)
  })

  test('repeat POST is idempotent: same manifest, same digests (byte-identical re-export)', async () => {
    const probe = await probeOnce()
    if (!engineUp(probe)) return
    const first = (probe.body as ExportRouteBody).report
    const again = await fetchJson('/api/wanyrix/export', { method: 'POST' })
    expect(again.status).toBe(200)
    const second = (again.body as ExportRouteBody).report
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  test('export is POST-only → 405 with Allow: POST (ENG-TCA-6a, mutating surface)', async () => {
    const res = await fetch(`${BASE_URL}/api/wanyrix/export`, {
      method: 'GET',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toContain('POST')
  })

  test('unknown workspace id → 404 named error, never a silent dogfood fallback', async () => {
    const res = await fetchJson(
      `/api/wanyrix/export?workspace=${encodeURIComponent('ws-local-not-a-real-row-91')}`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
    expectJson(res)
    expect((res.body as { error: string }).error).toContain(
      'no registered workspace with id ws-local-not-a-real-row-91',
    )
  })
})

// AUD-4 — counted skip banner: exact number of live cases this file skipped.
// afterAll, not module scope: bun runs describe bodies at collection time
// (after top-level evaluation), so the counted registration is only final here.
if (!serverUp) afterAll(() => skipBanner('wanyrix-export.test.ts', liveBase))
