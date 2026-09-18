import { NextRequest, NextResponse } from 'next/server'
import { getDoctor } from '@/lib/wanyrix/data'
import { notAllowedOnGetOnly, resolveWorkspace } from '@/lib/wanyrix/api'

/**
 * GET /api/wanyrix/doctor?ws= — build intelligence findings.
 * ENG-TCA-1: an unknown `ws` is a 404 with the known-workspace list — never a
 * silent substitution of the default workspace.
 */
export async function GET(req: NextRequest) {
  const { ws, error } = resolveWorkspace(req)
  if (error) return error
  return NextResponse.json(getDoctor(ws))
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
