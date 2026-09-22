import { NextRequest, NextResponse } from 'next/server'
import { getDoctor } from '@/lib/wanyrix/data'
import { notAllowedOnGetOnly, resolveWorkspace, workspaceParam } from '@/lib/wanyrix/api'
import { isRegisteredWorkspaceId } from '@/lib/wanyrix/register'
import {
  RegisteredScanError,
  RegisteredStoreError,
  findRegisteredWorkspace,
  registeredDoctorPayload,
} from '@/lib/wanyrix/registered-scan'

/**
 * GET /api/wanyrix/doctor?ws= — build intelligence findings.
 * ENG-TCA-1: an unknown `ws` is a 404 with the known-workspace list — never a
 * silent substitution of the default workspace.
 *
 * QA-5-B-1: a REGISTERED local project id (the `ws-local-…` bridge ids) is
 * served by running the REAL engine (`wanyrix doctor --path <stored path>
 * --json`) and adapting the measured envelope — the same honesty contract as
 * the engine-exec routes, in the web payload shape the views consume. Failures
 * are named (503 binary/store · 502 engine · 504 timeout), never fabricated.
 */
export async function GET(req: NextRequest) {
  const raw = workspaceParam(req)
  if (raw !== null && isRegisteredWorkspaceId(raw)) {
    try {
      const row = await findRegisteredWorkspace(raw)
      if (!row) {
        return NextResponse.json(
          { error: `no registered workspace with id ${raw} — connect it via POST /api/wanyrix/workspaces` },
          { status: 404 },
        )
      }
      return NextResponse.json(await registeredDoctorPayload(row))
    } catch (err) {
      if (err instanceof RegisteredStoreError) {
        console.error('[doctor] registered-workspace store unavailable:', err.detail)
        return NextResponse.json(
          { error: 'registered-workspace store unavailable — the scan was not started' },
          { status: 503 },
        )
      }
      if (err instanceof RegisteredScanError) {
        return NextResponse.json(err.payload, { status: err.status })
      }
      throw err
    }
  }
  const { ws, error } = resolveWorkspace(req)
  if (error) return error
  return NextResponse.json(getDoctor(ws))
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
