import { NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

/**
 * REAL instrumented build — `wanyrix.engine-build/v1` (R8).
 *
 * Sibling of the doctor exec route: this one spawns `wanyrix build --path
 * engine --json`, which makes the REAL binary execute a REAL
 * `cargo build --message-format=json` on this machine and measure it
 * (`wanyrix.build/v1`: wall clock, fresh/cache-hit rate from the stream's
 * artifact flags, redacted diagnostics). The stdout is returned VERBATIM,
 * parsed only to validate the envelope schema.
 *
 * This is the one surface where `cacheHitRate` is MEASURED — everywhere else
 * in the product the same field is honestly labeled `not-measured` (Gate 21).
 *
 * Error contract (identical shape to the doctor exec route):
 * 503 binary missing · 502 engine failure/unparseable output ·
 * 504 timeout · 405 wrong method (`Allow: GET`).
 *
 * Timeout is deliberately larger than the doctor route (20s → 120s): a cold
 * build may actually recompile crates; a warm build returns in ~100ms.
 * A cargo build that RAN but failed is DATA — the engine exits 0 with
 * `buildSuccess: false` inside the envelope, so it is served as a 200.
 */

const SCHEMA = 'wanyrix.engine-build/v1'

const EXEC_TIMEOUT_MS = 120_000
const MAX_BUFFER = 16 * 1024 * 1024

const execFileAsync = promisify(execFile)

/** Repo-root-relative engine crate dir — also the build target (dogfood). */
const ENGINE_DIR = path.join(process.cwd(), 'engine')

/** Binary candidates in preference order (profile label → path). */
const BINARY_CANDIDATES: { profile: 'debug' | 'release'; file: string }[] = [
  { profile: 'release', file: path.join(ENGINE_DIR, 'target', 'release', 'wanyrix') },
  { profile: 'debug', file: path.join(ENGINE_DIR, 'target', 'debug', 'wanyrix') },
]

async function firstExistingBinary(): Promise<{ profile: 'debug' | 'release'; file: string } | null> {
  for (const candidate of BINARY_CANDIDATES) {
    try {
      await access(candidate.file, constants.X_OK)
      return candidate
    } catch {
      // try the next profile
    }
  }
  return null
}

/** Light structural check — the full shape is owned by the engine + tests. */
function isBuildEnvelope(v: unknown): v is { schema?: unknown; [k: string]: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function GET() {
  const startedAt = Date.now()

  const binary = await firstExistingBinary()
  if (!binary) {
    return NextResponse.json(
      {
        error: 'engine binary not found on this machine — the real execution surface is unavailable',
        checked: BINARY_CANDIDATES.map((c) => path.relative(process.cwd(), c.file)),
        hint: 'build it: cd engine && cargo build --locked (see docs/DEVELOPMENT.md)',
      },
      { status: 503 },
    )
  }

  let versionOut: string
  try {
    const v = await execFileAsync(binary.file, ['--version'], {
      timeout: 20_000,
      maxBuffer: MAX_BUFFER,
    })
    versionOut = v.stdout.trim()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: 'engine binary could not be executed', detail: message.slice(0, 400) },
      { status: 502 },
    )
  }

  let stdout: string
  try {
    const run = await execFileAsync(binary.file, ['build', '--path', ENGINE_DIR, '--json'], {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    })
    stdout = run.stdout
  } catch (err) {
    const e = err as { code?: number | string; killed?: boolean; message?: string; stderr?: string }
    if (e.killed) {
      return NextResponse.json(
        { error: `engine build did not finish within ${EXEC_TIMEOUT_MS / 1000}s — killed` },
        { status: 504 },
      )
    }
    return NextResponse.json(
      {
        error: `engine exited with ${e.code ?? 'non-zero'} — the build could not be started (missing cargo?)`,
        detail: (e.stderr ?? e.message ?? '').slice(0, 400),
      },
      { status: 502 },
    )
  }

  let report: unknown
  try {
    report = JSON.parse(stdout)
  } catch (parseError) {
    return NextResponse.json(
      {
        error: 'engine emitted unparseable JSON — refusing to serve it as a report',
        detail: parseError instanceof Error ? parseError.message.slice(0, 200) : String(parseError),
      },
      { status: 502 },
    )
  }

  if (!isBuildEnvelope(report) || report.schema !== 'wanyrix.build/v1') {
    return NextResponse.json(
      {
        error: 'engine output is not a wanyrix.build/v1 envelope — refusing to serve it',
        detail: `got: ${String((report as { schema?: unknown })?.schema ?? '<no schema>')}`,
      },
      { status: 502 },
    )
  }

  return NextResponse.json({
    schema: SCHEMA,
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    binary: { version: versionOut, profile: binary.profile },
    scanTarget: path.relative(process.cwd(), ENGINE_DIR) + path.sep,
    note:
      'Verbatim stdout of a REAL `wanyrix build` executed on this machine (parsed only to ' +
      'validate the envelope). wallClockMs and cacheHitRate are measurements of an actual ' +
      'cargo build; per-artifact arrivalDeltaMs overlaps under parallel jobs and is not ' +
      'per-crate build time. A failed build is data (buildSuccess: false), not an HTTP error.',
    report,
  })
}

/** GET only — everything else → 405 with `Allow: GET`. */
export const POST = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
export const PUT = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
export const DELETE = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
export const PATCH = () =>
  NextResponse.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
