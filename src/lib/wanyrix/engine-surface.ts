import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ENGINE_DIR,
  EXEC_TIMEOUT_MS,
  checkedBinaryPaths,
  execEngine,
  resolveEngineBinary,
  type EngineBinary,
} from '@/lib/wanyrix/engine-exec'

/**
 * Shared plumbing for the engine v0.8.0 change-intelligence surfaces
 * (issue #69): `git` / `impact` / `what-changed`.
 *
 * This mirrors the engine/doctor route's guards and named-error shapes
 * VERBATIM (same 503 checked-list payload, same 502 exit/unparseable wording,
 * same registered-workspace resolution) without touching the doctor/build
 * routes — the three new routes are the only consumers. The doctor/build
 * routes keep their own local copies (established pattern).
 *
 * Security invariants inherited from engine-exec.ts:
 *   - user input NEVER passes through a shell — `execFile` with an args array
 *     only, capped buffers, hard timeouts;
 *   - the scan target is either the repo's own engine crate (dogfood) or a
 *     DB-registered workspace path — NEVER a request-supplied path;
 *   - the what-changed store path is derived server-side from the same
 *     target (`<target>/.wanyrix/store.db` — the engine's own `.wanyrix`
 *     state-dir convention), so request params never reach a filesystem path.
 *
 * Workspace resolution (same contract as `GET /api/wanyrix/engine/doctor`):
 *   - `?workspace=<id>` (or the `?ws=` alias) → a REGISTERED local project
 *     looked up in the Prisma store (404 unknown id / 503 store down);
 *   - absent/empty param → the engine crate itself (dogfood, ENG-TCA-1:
 *     empty param = param absent).
 */

export interface ResolvedExecTarget {
  /** absolute path the engine command runs against (server-derived only) */
  targetPath: string
  /** the registered row when the request named one, else null (dogfood) */
  registered: { id: string; path: string } | null
}

/**
 * Resolves the exec target for a request. Returns either the resolved
 * target or a ready-to-send named error (404 unknown id / 503 store down) —
 * `NextResponse` is distinguishable from {@link ResolvedExecTarget} by its
 * `status` property.
 */
export async function resolveExecTarget(
  req: NextRequest,
  routeLabel: string,
): Promise<ResolvedExecTarget | NextResponse> {
  const param = req.nextUrl.searchParams.get('workspace') ?? req.nextUrl.searchParams.get('ws')
  if (param === null || param === '') {
    return { targetPath: ENGINE_DIR, registered: null }
  }
  try {
    const registered = await db.registeredWorkspace.findUnique({ where: { id: param } })
    if (!registered) {
      return NextResponse.json(
        { error: `no registered workspace with id ${param}` },
        { status: 404 },
      )
    }
    return { targetPath: registered.path, registered: { id: registered.id, path: registered.path } }
  } catch (err) {
    console.error(`[engine-surface:${routeLabel}] registered-workspace lookup failed:`, err)
    return NextResponse.json(
      { error: 'registered-workspace store unavailable — the request was not started' },
      { status: 503 },
    )
  }
}

/* ------------------------------------------------- named error responses -- */
/* Verbatim mirrors of the engine/doctor route helpers (same shape, same
   wording) so every real-exec surface degrades identically. */

export function binaryMissingResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'engine binary not found on this machine — the real execution surface is unavailable',
      checked: checkedBinaryPaths(),
      hint: 'build it: cd engine && cargo build --locked (see docs/DEVELOPMENT.md)',
    },
    { status: 503 },
  )
}

export function engineTimeoutResponse(): NextResponse {
  return NextResponse.json(
    { error: `engine did not finish within ${EXEC_TIMEOUT_MS / 1000}s — killed` },
    { status: 504 },
  )
}

export function engineExitResponse(run: { code?: number | string; stderr: string }): NextResponse {
  return NextResponse.json(
    {
      error: `engine exited with ${run.code ?? 'non-zero'} — findings are data, but the scan itself failed`,
      detail: run.stderr.slice(0, 400),
    },
    { status: 502 },
  )
}

export function unparseableResponse(parseError: unknown): NextResponse {
  return NextResponse.json(
    {
      error: 'engine emitted unparseable JSON — refusing to serve it as a report',
      detail: parseError instanceof Error ? parseError.message.slice(0, 200) : String(parseError),
    },
    { status: 502 },
  )
}

export function schemaMismatchResponse(expected: string, report: unknown): NextResponse {
  return NextResponse.json(
    {
      error: `engine output is not a ${expected} envelope — refusing to serve it`,
      detail: `got: ${String((report as { schema?: unknown })?.schema ?? '<no schema>')}`,
    },
    { status: 502 },
  )
}

/* ------------------------------------------------------------ version probe */

export interface ProbedBinary {
  binary: EngineBinary
  version: string
}

/**
 * Resolves the binary and measures `wanyrix --version` for the envelope's
 * execution metadata — the doctor route's contract (`binary.version` is the
 * REAL binary's self-report, never a web-side constant).
 */
export async function probeBinary(): Promise<ProbedBinary | NextResponse> {
  const binary = await resolveEngineBinary()
  if (!binary) return binaryMissingResponse()
  const versionRun = await execEngine(['--version'])
  if (versionRun.killed || versionRun.code !== undefined) {
    return NextResponse.json(
      { error: 'engine binary could not be executed', detail: versionRun.stderr.slice(0, 400) },
      { status: 502 },
    )
  }
  return { binary, version: versionRun.stdout.trim() }
}

/* -------------------------------------------------------------------- note */

/**
 * The honesty note carried by every engine-exec envelope: what executed,
 * against which kind of target, and what the route did to the output.
 */
export function surfaceNote(surface: string, registered: boolean): string {
  const target = registered
    ? 'a REGISTERED local project (workspace registration bridge)'
    : 'the repo engine crate (the tool dogfoods on its own source)'
  return (
    `Verbatim stdout of the real wanyrix binary executed on this machine (${surface}, against ${target}), ` +
    'parsed only to validate the envelope schema. Measured data only — nothing is simulated.'
  )
}
