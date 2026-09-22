/**
 * Registered-workspace data plane (QA-5-B-1) — SERVER module.
 *
 * One spawn discipline for the fixture routes' registered-workspace branch:
 * the routes resolve the row from the Prisma store, then THIS module runs the
 * REAL `wanyrix` binary against the registered path (never a request path —
 * the same security invariant as the engine-exec routes) and adapts the
 * envelopes via ./registered-adapters.
 *
 * Error contract (named, honest — the caller returns them verbatim):
 *   - RegisteredStoreError            → 503 (registered-workspace store down)
 *   - engine binary missing           → 503 payload with `checked` + build hint
 *   - engine timeout (killed)         → 504
 *   - engine non-zero exit            → 502 with stderr detail
 *   - unparseable / wrong-schema JSON → 502
 *
 * doctor/graph run in parallel for the health payload (worst case = one
 * 20s engine timeout, not two).
 */

import { db } from '@/lib/db'
import type { RegisteredWorkspace } from '@prisma/client'
import {
  EXEC_TIMEOUT_MS,
  checkedBinaryPaths,
  execEngine,
  resolveEngineBinary,
} from '@/lib/wanyrix/engine-exec'
import type { RegisteredWorkspaceSummary } from '@/lib/wanyrix/types'
import {
  doctorReportFromEngine,
  graphPayloadFromEngine,
  healthPayloadFromEngine,
  type EngineDoctorEnvelope,
  type EngineGraphEnvelope,
} from '@/lib/wanyrix/registered-adapters'
import type { DoctorReport, GraphPayload, HealthPayload } from '@/lib/wanyrix/types'

/** Error carrying a ready-to-send JSON payload + HTTP status. */
export class RegisteredScanError extends Error {
  readonly status: number
  readonly payload: Record<string, unknown>
  constructor(status: number, payload: Record<string, unknown>, message?: string) {
    super(message ?? String(payload.error ?? 'registered workspace scan failed'))
    this.name = 'RegisteredScanError'
    this.status = status
    this.payload = payload
  }
}

/** The store is unreachable — routes map this to the honest 503. */
export class RegisteredStoreError extends Error {
  constructor(detail: unknown) {
    super('registered-workspace store unavailable')
    this.name = 'RegisteredStoreError'
    this.detail = detail
  }
  readonly detail: unknown
}

/** Wire shape of a stored row (mirrors the workspaces route's toDto). */
function toDto(r: RegisteredWorkspace): RegisteredWorkspaceSummary {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    registeredAt: r.registeredAt.toISOString(),
    lastCheckedAt: r.lastCheckedAt.toISOString(),
    lastStatus: r.lastStatus as RegisteredWorkspaceSummary['lastStatus'],
    crates: r.crates,
    edges: r.edges,
    findings: r.findings,
    critical: r.critical,
    warning: r.warning,
    info: r.info,
    toolchain: r.toolchain,
    fixtureOnly: false,
  }
}

/**
 * Resolves a registered-workspace id to its stored row.
 * - unknown id  → null (caller renders the named 404)
 * - store down  → throws RegisteredStoreError (caller → 503)
 */
export async function findRegisteredWorkspace(
  id: string,
): Promise<RegisteredWorkspaceSummary | null> {
  try {
    const row = await db.registeredWorkspace.findUnique({ where: { id } })
    return row ? toDto(row) : null
  } catch (err) {
    throw new RegisteredStoreError(err)
  }
}

/** One guarded engine spawn → parsed JSON envelope or a named 502/503/504. */
async function runEngineJson(
  args: string[],
  schema: string,
  label: string,
): Promise<Record<string, unknown>> {
  const binary = await resolveEngineBinary()
  if (!binary) {
    throw new RegisteredScanError(503, {
      error: 'engine binary not found on this machine — the real execution surface is unavailable',
      checked: checkedBinaryPaths(),
      hint: 'build it: cd engine && cargo build --locked (see docs/DEVELOPMENT.md)',
    })
  }
  const run = await execEngine(args, EXEC_TIMEOUT_MS)
  if (run.killed) {
    throw new RegisteredScanError(504, {
      error: `engine ${label} did not finish within ${EXEC_TIMEOUT_MS / 1000}s — killed`,
    })
  }
  if (run.code !== undefined) {
    throw new RegisteredScanError(502, {
      error: `engine ${label} exited with ${run.code} — the scan failed`,
      detail: run.stderr.slice(0, 400),
    })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch (parseError) {
    throw new RegisteredScanError(502, {
      error: `engine ${label} emitted unparseable JSON — refusing to serve it`,
      detail: parseError instanceof Error ? parseError.message.slice(0, 200) : String(parseError),
    })
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { schema?: unknown }).schema !== schema
  ) {
    throw new RegisteredScanError(502, {
      error: `engine ${label} output is not a ${schema} envelope — refusing to serve it`,
      detail: `got: ${String((parsed as { schema?: unknown } | null)?.schema ?? '<no schema>')}`,
    })
  }
  return parsed as Record<string, unknown>
}

/** REAL `wanyrix doctor` against the registered path → web DoctorReport. */
export async function registeredDoctorPayload(row: RegisteredWorkspaceSummary): Promise<DoctorReport> {
  const report = await runEngineJson(
    ['doctor', '--path', row.path, '--json'],
    'wanyrix.doctor/v1',
    'doctor',
  )
  return doctorReportFromEngine(report as EngineDoctorEnvelope)
}

/** REAL `wanyrix graph` against the registered path → web GraphPayload. */
export async function registeredGraphPayload(row: RegisteredWorkspaceSummary): Promise<GraphPayload> {
  const report = await runEngineJson(
    ['graph', '--path', row.path, '--json'],
    'wanyrix.graph/v1',
    'graph',
  )
  return graphPayloadFromEngine(report as EngineGraphEnvelope)
}

/** REAL doctor + graph (parallel) → web HealthPayload for the Overview. */
export async function registeredHealthPayload(row: RegisteredWorkspaceSummary): Promise<HealthPayload> {
  const [doctor, graph] = await Promise.all([
    registeredDoctorPayload(row),
    registeredGraphPayload(row),
  ])
  return healthPayloadFromEngine(doctor, graph)
}
