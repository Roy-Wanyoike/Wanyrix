import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import path from 'node:path'
import { ENGINE_DIR, execEngine } from '@/lib/wanyrix/engine-exec'
import {
  binaryMissingResponse,
  engineTimeoutResponse,
  probeBinary,
  resolveExecTarget,
  schemaMismatchResponse,
  surfaceNote,
  unparseableResponse,
} from '@/lib/wanyrix/engine-surface'

/**
 * REAL deterministic change intelligence — `wanyrix what-changed --path
 * <target> --db <store> --json` (issue #69).
 *
 * Sibling of the engine/doctor + engine/build exec routes: spawns the actual
 * binary and returns its `wanyrix.what-changed/v1` stdout VERBATIM (parsed
 * only to validate the envelope schema) inside the shared
 * `wanyrix.engine-exec/v1` wrapper. Added/resolved/changed findings and the
 * severity delta are measured against the stored baseline scan — never
 * invented.
 *
 * Scan-store convention: the engine's own `.wanyrix` state dir (same place
 * `wanyrix init` writes state.json and the ledger writes events.jsonl), so
 * the route derives the store path SERVER-SIDE as
 * `<scanTarget>/.wanyrix/store.db`. Request params never reach a filesystem
 * path. A workspace with no initialized store is an HONEST named error: the
 * engine exits 2 ("scan store error: store not found at …") and the route
 * serves it verbatim as a 503 with the store-init hint — the same shape the
 * binary-missing 503 uses (unavailable precondition, client-fixable).
 * An INITIALIZED but baseline-less store is NOT an error: the engine then
 * returns a valid envelope (`against` omitted + `baselineNote`) which is
 * served and rendered as-is.
 *
 * Scan target resolution (same as engine/doctor): `?workspace=<id>` (or
 * `?ws=`) names a REGISTERED local project; absent → the repo engine crate.
 *
 * Error contract: 503 binary missing OR store not initialized (engine stderr
 * verbatim in `detail`) · 502 unparseable/schema mismatch · 504 timeout ·
 * 404 unknown workspace id · 405 wrong method (`Allow: GET`).
 */

const SCHEMA = 'wanyrix.engine-exec/v1'
const WHAT_CHANGED_ENVELOPE = 'wanyrix.what-changed/v1'

/** Light structural check — the full shape is owned by the engine + conformance tests. */
function isEnvelope(v: unknown): v is { schema?: unknown; [k: string]: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now()

  const target = await resolveExecTarget(req, 'what-changed')
  if (target instanceof NextResponse) return target

  const probed = await probeBinary()
  if (probed instanceof NextResponse) return probed
  const { binary, version } = probed

  // Server-derived store path — the engine's `.wanyrix` state-dir convention.
  const storePath = path.join(target.targetPath, '.wanyrix', 'store.db')

  const run = await execEngine([
    'what-changed',
    '--path',
    target.targetPath,
    '--db',
    storePath,
    '--json',
  ])
  if (run.killed) return engineTimeoutResponse()

  // The engine exits 2 for EVERY what-changed failure; the dominant case is
  // the uninitialized store (an unavailable precondition the user can fix —
  // hence 503 + hint, mirroring the binary-missing shape, with the engine's
  // named error quoted VERBATIM in detail). Other failures keep the same
  // honest 503 shape; the verbatim stderr always tells the real story.
  if (run.code !== undefined) {
    return NextResponse.json(
      {
        error: `what-changed store unavailable — engine exited with ${run.code}`,
        detail: run.stderr.slice(0, 400),
        ...(run.stderr.includes('store not found')
          ? {
              hint: `initialize it: wanyrix store init --db ${storePath} (then record a baseline: wanyrix store save --db ${storePath} --scan <doctor --json output>)`,
            }
          : {}),
      },
      { status: 503 },
    )
  }

  let report: unknown
  try {
    report = JSON.parse(run.stdout)
  } catch (parseError) {
    return unparseableResponse(parseError)
  }
  if (!isEnvelope(report) || report.schema !== WHAT_CHANGED_ENVELOPE) {
    return schemaMismatchResponse(WHAT_CHANGED_ENVELOPE, report)
  }

  return NextResponse.json({
    schema: SCHEMA,
    surface: 'what-changed',
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    binary: { version, profile: binary.profile },
    scanTarget: target.registered
      ? target.registered.path
      : path.relative(process.cwd(), ENGINE_DIR) + path.sep,
    ...(target.registered ? { workspaceId: target.registered.id } : {}),
    note: surfaceNote('wanyrix what-changed', target.registered !== null),
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
