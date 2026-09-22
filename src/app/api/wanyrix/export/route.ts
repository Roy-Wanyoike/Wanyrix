import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import path from 'node:path'
import { ENGINE_DIR, execEngine } from '@/lib/wanyrix/engine-exec'
import {
  engineTimeoutResponse,
  probeBinary,
  resolveExecTarget,
  schemaMismatchResponse,
  surfaceNote,
  unparseableResponse,
} from '@/lib/wanyrix/engine-surface'

/**
 * REAL artifacts-as-code export — `wanyrix export --path <target> --json`
 * (issue #91). Sibling of the git/impact/what-changed exec routes: spawns
 * the actual binary and returns its `wanyrix.export/v1` manifest stdout
 * VERBATIM (parsed only to validate the envelope schema) inside the shared
 * `wanyrix.engine-exec/v1` wrapper.
 *
 * POST on purpose: unlike the read-only exec surfaces, export WRITES —
 * the engine materializes `doctor.json` / `graph.json` / `health.json` +
 * `index.json` (sha256-bound manifest, no wall-clock timestamps, relative
 * paths only — byte-identical repeat exports) under the scan target's own
 * `.wanyrix/exports` state dir. Everything else mirrors the family
 * contract: registered-workspace resolution (`?workspace=<id>` / `?ws=`
 * alias, dogfood engine crate by default), named engine errors quoted
 * verbatim, honest 503 when the binary is not built on this host.
 *
 * Server-derived paths (request params NEVER reach a filesystem path):
 * the route converts the resolved target to a path RELATIVE to the server
 * cwd before spawning — the export contract refuses absolute `--path`
 * (`export error: … absolute`) because artifacts must never embed
 * absolute paths — and lets the engine default the out dir to
 * `<target>/.wanyrix/exports` (the same `.wanyrix` state-dir convention
 * the what-changed store path uses). There are no REQUIRED request
 * params (the dogfood default mirrors the whole #69 family), so the
 * family's 400-missing-param case has no counterpart here; the only
 * 503 precondition is the binary-missing one.
 *
 * Error contract: 503 binary missing (checked list + build hint) · 502
 * engine exit (stderr verbatim in `detail` — carries the engine's named
 * export refusals) · 502 unparseable/schema mismatch · 504 timeout ·
 * 404 unknown workspace id · 405 wrong method (`Allow: POST`).
 */

const SCHEMA = 'wanyrix.engine-exec/v1'
const EXPORT_MANIFEST = 'wanyrix.export/v1'

/** Light structural check — the full shape is owned by the engine + conformance tests. */
function isEnvelope(v: unknown): v is { schema?: unknown; [k: string]: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Relative-to-cwd form of an absolute server path ('.' for the cwd itself). */
function toRelative(targetPath: string): string {
  const rel = path.relative(process.cwd(), targetPath)
  return rel === '' ? '.' : rel
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()

  const target = await resolveExecTarget(req, 'export')
  if (target instanceof NextResponse) return target

  const probed = await probeBinary()
  if (probed instanceof NextResponse) return probed
  const { binary, version } = probed

  // Relative --path (export refuses absolute paths so artifacts stay
  // portable); the engine defaults --out to <target>/.wanyrix/exports.
  const run = await execEngine(['export', '--path', toRelative(target.targetPath), '--json'])
  if (run.killed) return engineTimeoutResponse()

  // The engine exits 2 for every export refusal (absolute paths, <out>
  // existing as a file, unwritable target, unscannable workspace). The
  // named error is quoted VERBATIM in detail — the 502 of the #69 family,
  // never a silent failure and never a rewritten engine message.
  if (run.code !== undefined) {
    return NextResponse.json(
      {
        error: `export failed — engine exited with ${run.code}`,
        detail: run.stderr.slice(0, 400),
      },
      { status: 502 },
    )
  }

  let report: unknown
  try {
    report = JSON.parse(run.stdout)
  } catch (parseError) {
    return unparseableResponse(parseError)
  }
  if (!isEnvelope(report) || report.schema !== EXPORT_MANIFEST) {
    return schemaMismatchResponse(EXPORT_MANIFEST, report)
  }

  return NextResponse.json({
    schema: SCHEMA,
    surface: 'export',
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    binary: { version, profile: binary.profile },
    scanTarget: target.registered
      ? target.registered.path
      : path.relative(process.cwd(), ENGINE_DIR) + path.sep,
    ...(target.registered ? { workspaceId: target.registered.id } : {}),
    note: surfaceNote('wanyrix export', target.registered !== null),
    report,
  })
}

/** POST only — export mutates the target's `.wanyrix/exports`; everything else → 405 with `Allow: POST` (ENG-TCA-6a). */
export const GET = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
export const PUT = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
export const DELETE = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
export const PATCH = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
