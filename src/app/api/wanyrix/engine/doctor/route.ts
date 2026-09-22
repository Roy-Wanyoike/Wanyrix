import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import path from 'node:path'
import { db } from '@/lib/db'
import { workspaceParam } from '@/lib/wanyrix/api'
import {
  ENGINE_DIR,
  EXEC_TIMEOUT_MS,
  checkedBinaryPaths,
  execEngine,
  resolveEngineBinary,
} from '@/lib/wanyrix/engine-exec'

/**
 * REAL engine execution — `wanyrix.engine-exec/v1`.
 *
 * Every other route serves the deterministic fixture layer (the web demo
 * mirrors the CLI honestly, but nothing executes). THIS route actually spawns
 * the `wanyrix` binary built from `engine/` on the host machine and returns
 * its stdout VERBATIM (parsed only to validate the envelope schema).
 *
 * Two scan targets (Task 2-b):
 *   - default (no params)  → the engine crate itself — the tool dogfoods on
 *     its own source;
 *   - `?workspace=<id>` or the `?ws=` alias (issue #129: both spellings on
 *     every ws-scoped surface, `ws` wins when both are present) → a
 *     REGISTERED local project (the workspace registration bridge). The id
 *     must exist in the RegisteredWorkspace store; only registered paths are
 *     ever scanned — arbitrary request paths are never passed to the binary.
 *
 * Honesty contract (Gate 21 / Gate 7):
 *   - `report` is exactly what the binary measured and emitted — the route
 *     adds execution metadata only (`version`, `profile`, `durationMs`).
 *   - The engine deliberately does NOT emit build-time telemetry
 *     (`wanyrix.doctor/v1` vs the web demo's `DoctorReport` — see
 *     engine/README.md); the two envelopes are never conflated here.
 *   - Binary missing (not built on this machine) ⇒ honest 503 with the exact
 *     paths checked and a build hint — never a fabricated report.
 *   - A workspace scan refreshes the stored measured counts (lastCheckedAt,
 *     lastStatus, findings/critical/warning/info) — never invents them.
 *
 * Error contract: 503 binary missing · 502 engine failure/unparseable output ·
 * 504 timeout · 404 unknown workspace id · 405 wrong method (`Allow: GET`).
 */

const SCHEMA = 'wanyrix.engine-exec/v1'
const DOCTOR_ENVELOPE = 'wanyrix.doctor/v1'

const DOGFOOD_NOTE =
  'Verbatim stdout of the real wanyrix binary executed on this machine (parsed only to ' +
  'validate the envelope). The engine emits wanyrix.doctor/v1 — build-time telemetry is ' +
  'deliberately absent (honesty gates); that data exists only in the web demo layer.'

const REGISTERED_NOTE =
  'Verbatim stdout of the real wanyrix binary executed on this machine against a REGISTERED ' +
  'local project (parsed only to validate the envelope). The engine emits wanyrix.doctor/v1 — ' +
  'build-time telemetry is deliberately absent (honesty gates); that data exists only in the ' +
  'web demo layer. The verdict counts were measured on the registered path — nothing is simulated.'

/** Light structural check — the full shape is owned by the engine + conformance tests. */
function isDoctorEnvelope(v: unknown): v is { schema?: unknown; [k: string]: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/* ------------------------------------------------- named error responses -- */

function binaryMissingResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'engine binary not found on this machine — the real execution surface is unavailable',
      checked: checkedBinaryPaths(),
      hint: 'build it: cd engine && cargo build --locked (see docs/DEVELOPMENT.md)',
    },
    { status: 503 },
  )
}

function engineTimeoutResponse(): NextResponse {
  return NextResponse.json(
    { error: `engine did not finish within ${EXEC_TIMEOUT_MS / 1000}s — killed` },
    { status: 504 },
  )
}

function engineExitResponse(run: { code?: number | string; stderr: string }): NextResponse {
  return NextResponse.json(
    {
      error: `engine exited with ${run.code ?? 'non-zero'} — findings are data, but the scan itself failed`,
      detail: run.stderr.slice(0, 400),
    },
    { status: 502 },
  )
}

function unparseableResponse(parseError: unknown): NextResponse {
  return NextResponse.json(
    {
      error: 'engine emitted unparseable JSON — refusing to serve it as a report',
      detail: parseError instanceof Error ? parseError.message.slice(0, 200) : String(parseError),
    },
    { status: 502 },
  )
}

function schemaMismatchResponse(report: unknown): NextResponse {
  return NextResponse.json(
    {
      error: 'engine output is not a wanyrix.doctor/v1 envelope — refusing to serve it',
      detail: `got: ${String((report as { schema?: unknown })?.schema ?? '<no schema>')}`,
    },
    { status: 502 },
  )
}

/**
 * Extracts the MEASURED severity counts from a doctor envelope. Primary
 * source is the envelope's own `summary` (engine-emitted usize counts);
 * falls back to counting the `findings` array when a summary is malformed.
 * Nothing is ever invented — every fallback reads the same envelope.
 */
function measuredCounts(report: Record<string, unknown>): {
  findings: number
  critical: number
  warning: number
  info: number
} {
  const summary = report.summary as
    | { critical?: unknown; warning?: unknown; info?: unknown; total?: unknown }
    | undefined
  if (
    typeof summary?.critical === 'number' &&
    typeof summary.warning === 'number' &&
    typeof summary.info === 'number'
  ) {
    return {
      critical: summary.critical,
      warning: summary.warning,
      info: summary.info,
      findings:
        typeof summary.total === 'number'
          ? summary.total
          : summary.critical + summary.warning + summary.info,
    }
  }
  const findingsList = report.findings
  if (Array.isArray(findingsList)) {
    const count = (severity: string) =>
      findingsList.filter((f) => (f as { severity?: unknown })?.severity === severity).length
    const critical = count('critical')
    const warning = count('warning')
    const info = count('info')
    return { critical, warning, info, findings: critical + warning + info }
  }
  return { findings: 0, critical: 0, warning: 0, info: 0 }
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now()

  /* ------------------------------------------------ registered-workspace? -- */
  // `?workspace=<id>` (or the `?ws=` alias, issue #129) scans a REGISTERED
  // local project; absent/empty → the dogfood default (ENG-TCA-1 convention:
  // empty param = param absent).
  const workspaceParamValue = workspaceParam(req)
  let registered: Awaited<ReturnType<typeof db.registeredWorkspace.findUnique>> = null
  if (workspaceParamValue !== null && workspaceParamValue !== '') {
    try {
      registered = await db.registeredWorkspace.findUnique({ where: { id: workspaceParamValue } })
    } catch (err) {
      console.error('[engine/doctor] registered-workspace lookup failed:', err)
      return NextResponse.json(
        { error: 'registered-workspace store unavailable — the scan was not started' },
        { status: 503 },
      )
    }
    if (!registered) {
      return NextResponse.json(
        { error: `no registered workspace with id ${workspaceParamValue}` },
        { status: 404 },
      )
    }
  }

  /* --------------------------------------------------------- real binary -- */
  const binary = await resolveEngineBinary()
  if (!binary) return binaryMissingResponse()

  const versionRun = await execEngine(['--version'])
  if (versionRun.killed || versionRun.code !== undefined) {
    return NextResponse.json(
      { error: 'engine binary could not be executed', detail: versionRun.stderr.slice(0, 400) },
      { status: 502 },
    )
  }
  const versionOut: string = versionRun.stdout.trim()

  const scanTargetPath = registered ? registered.path : ENGINE_DIR

  const run = await execEngine(['doctor', '--path', scanTargetPath, '--json', '--pretty'])
  if (run.killed) return engineTimeoutResponse()
  if (run.code !== undefined) return engineExitResponse(run)

  let report: unknown
  try {
    report = JSON.parse(run.stdout)
  } catch (parseError) {
    return unparseableResponse(parseError)
  }

  if (!isDoctorEnvelope(report) || report.schema !== DOCTOR_ENVELOPE) {
    return schemaMismatchResponse(report)
  }

  /* -------------------------------------- measured refresh of the row ----- */
  if (registered) {
    const counts = measuredCounts(report)
    try {
      await db.registeredWorkspace.update({
        where: { id: registered.id },
        data: {
          lastCheckedAt: new Date(),
          lastStatus: 'ok',
          findings: counts.findings,
          critical: counts.critical,
          warning: counts.warning,
          info: counts.info,
        },
      })
    } catch (err) {
      // The scan itself succeeded and is served truthfully; the stored-row
      // refresh failing is logged, never papered over with fake data.
      console.error('[engine/doctor] registered-workspace refresh failed:', err)
    }
  }

  return NextResponse.json({
    schema: SCHEMA,
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    binary: { version: versionOut, profile: binary.profile },
    scanTarget: registered ? registered.path : path.relative(process.cwd(), ENGINE_DIR) + path.sep,
    ...(registered ? { workspaceId: registered.id } : {}),
    note: registered ? REGISTERED_NOTE : DOGFOOD_NOTE,
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
