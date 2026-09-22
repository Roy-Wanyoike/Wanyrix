import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import path from 'node:path'
import { ENGINE_DIR, execEngine } from '@/lib/wanyrix/engine-exec'
import {
  engineExitResponse,
  engineTimeoutResponse,
  probeBinary,
  resolveExecTarget,
  schemaMismatchResponse,
  surfaceNote,
  unparseableResponse,
} from '@/lib/wanyrix/engine-surface'

/**
 * REAL git intelligence — `wanyrix git --path <target> --json` (issue #69).
 *
 * Sibling of the engine/doctor + engine/build exec routes: spawns the actual
 * binary and returns its `wanyrix.git/v1` stdout VERBATIM (parsed only to
 * validate the envelope schema) inside the shared `wanyrix.engine-exec/v1`
 * wrapper. Measured repository state only — branch, dirty flag, changed /
 * untracked files, changed crates, recent commits. Nothing is simulated.
 *
 * Scan target resolution (same as engine/doctor): `?workspace=<id>` (or
 * `?ws=`) names a REGISTERED local project; absent → the repo engine crate.
 *
 * Error contract (identical shape to the doctor exec route):
 * 503 binary missing · 502 engine failure/unparseable/schema mismatch ·
 * 504 timeout · 404 unknown workspace id · 405 wrong method (`Allow: GET`).
 */

const SCHEMA = 'wanyrix.engine-exec/v1'
const GIT_ENVELOPE = 'wanyrix.git/v1'

/** Light structural check — the full shape is owned by the engine + conformance tests. */
function isEnvelope(v: unknown): v is { schema?: unknown; [k: string]: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now()

  const target = await resolveExecTarget(req, 'git')
  if (target instanceof NextResponse) return target

  const probed = await probeBinary()
  if (probed instanceof NextResponse) return probed
  const { binary, version } = probed

  const run = await execEngine(['git', '--path', target.targetPath, '--json'])
  if (run.killed) return engineTimeoutResponse()
  if (run.code !== undefined) return engineExitResponse(run)

  let report: unknown
  try {
    report = JSON.parse(run.stdout)
  } catch (parseError) {
    return unparseableResponse(parseError)
  }
  if (!isEnvelope(report) || report.schema !== GIT_ENVELOPE) {
    return schemaMismatchResponse(GIT_ENVELOPE, report)
  }

  return NextResponse.json({
    schema: SCHEMA,
    surface: 'git',
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    binary: { version, profile: binary.profile },
    scanTarget: target.registered
      ? target.registered.path
      : path.relative(process.cwd(), ENGINE_DIR) + path.sep,
    ...(target.registered ? { workspaceId: target.registered.id } : {}),
    note: surfaceNote('wanyrix git', target.registered !== null),
    report,
  })
}

/** GET only — everything else → 405 with `Allow: GET` (ENG-TCA-6a). */
export const POST = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
export const PUT = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
export const DELETE = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
export const PATCH = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
