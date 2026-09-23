import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import path from 'node:path'
import { ENGINE_DIR, execEngine } from '@/lib/wanyrix/engine-exec'
import { CRATE_PARAM_MAX_LENGTH, isValidCrateParam } from '@/lib/wanyrix/api'
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
 * REAL rebuild blast radius — `wanyrix impact --crate <name> --path <target>
 * --json` (issue #69).
 *
 * Sibling of the engine/doctor + engine/build exec routes: spawns the actual
 * binary and returns its `wanyrix.impact/v1` stdout VERBATIM (parsed only to
 * validate the envelope schema) inside the shared `wanyrix.engine-exec/v1`
 * wrapper. Measured dependency edges only — direct dependents by kind,
 * transitive dependents, workspace crate count, blast radius per mille.
 * Nothing is simulated.
 *
 * ROUTING NOTE (issue #69 deviation, deliberate): the spec sketch named
 * `/api/wanyrix/impact`, but that URL is ALREADY the fixture-backed
 * engineering cost calculator (`?type=&target=`, pinned by the ENG-TCA-6b
 * live tests). Conflating a fixture surface with a real-exec surface on one
 * URL would blur the measured/estimated boundary this repo is built on
 * (Gate 21), so the real surface mounts under `engine/` — the established
 * home of binary-executing routes (engine/doctor, engine/build).
 *
 * Scan target resolution (same as engine/doctor): `?workspace=<id>` (or
 * `?ws=`) names a REGISTERED local project; absent → the repo engine crate.
 *
 * Error contract: 400 missing `crate` param (ENG-TCA-6b — client input
 * error) · 400 invalid `crate` (issue #140 — the value must match
 * `^[A-Za-z0-9_-]+$` BEFORE it reaches engine argv, so flag-shaped /
 * whitespace / unicode values get a clean 400 instead of a 502 quoting an
 * engine clap refusal) · 503 binary missing · 502 engine failure (the
 * engine's named "crate 'X' is not a workspace crate under <root>" is
 * quoted verbatim in `detail`) /unparseable/schema mismatch · 504 timeout ·
 * 404 unknown workspace id · 405 wrong method (`Allow: GET`).
 */

const SCHEMA = 'wanyrix.engine-exec/v1'
const IMPACT_ENVELOPE = 'wanyrix.impact/v1'

/** Light structural check — the full shape is owned by the engine + conformance tests. */
function isEnvelope(v: unknown): v is { schema?: unknown; [k: string]: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now()

  // Input validation first — a missing crate is a client error, not an
  // engine failure (ENG-TCA-6b: missing required param → 400).
  const crate = req.nextUrl.searchParams.get('crate')
  if (crate === null || crate.trim() === '') {
    return NextResponse.json({ error: "missing required param 'crate'" }, { status: 400 })
  }
  // Issue #140 — argv hygiene: the crate name is the ONLY request value that
  // reaches engine argv verbatim (`impact --crate <value>`), so it must be a
  // plausible crate name: `^[A-Za-z0-9_-]+$`, ≤64 chars (crates.io cap), and
  // no leading `-` (a flag lookalike like `--version` is an argv token, never
  // a crate name). Refuse everything else HERE with a named 400 — before the
  // spawn — instead of surfacing the engine's clap exit as 502 noise.
  // (execFile args-array discipline is unchanged; this is input validation,
  // not shell-escaping.)
  const crateName = crate.trim()
  if (!isValidCrateParam(crateName)) {
    return NextResponse.json(
      {
        error: `invalid crate '${crateName}' — must be a crate name: ^[A-Za-z0-9_-]+$, ≤${CRATE_PARAM_MAX_LENGTH} chars, no leading '-'`,
      },
      { status: 400 },
    )
  }

  const target = await resolveExecTarget(req, 'impact')
  if (target instanceof NextResponse) return target

  const probed = await probeBinary()
  if (probed instanceof NextResponse) return probed
  const { binary, version } = probed

  const run = await execEngine([
    'impact',
    '--crate',
    crateName,
    '--path',
    target.targetPath,
    '--json',
  ])
  if (run.killed) return engineTimeoutResponse()
  if (run.code !== undefined) return engineExitResponse(run)

  let report: unknown
  try {
    report = JSON.parse(run.stdout)
  } catch (parseError) {
    return unparseableResponse(parseError)
  }
  if (!isEnvelope(report) || report.schema !== IMPACT_ENVELOPE) {
    return schemaMismatchResponse(IMPACT_ENVELOPE, report)
  }

  return NextResponse.json({
    schema: SCHEMA,
    surface: 'impact',
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    binary: { version, profile: binary.profile },
    scanTarget: target.registered
      ? target.registered.path
      : path.relative(process.cwd(), ENGINE_DIR) + path.sep,
    ...(target.registered ? { workspaceId: target.registered.id } : {}),
    note: surfaceNote('wanyrix impact', target.registered !== null),
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
