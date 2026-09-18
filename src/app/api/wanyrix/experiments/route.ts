import { NextRequest, NextResponse } from 'next/server'
import { getExperiments } from '@/lib/wanyrix/data'
import { notAllowedOnGetOnly, resolveWorkspace } from '@/lib/wanyrix/api'

/**
 * GET /api/wanyrix/experiments?ws= — experiment engine runs for a workspace.
 * ENG-TCA-1: unknown `ws` → 404 with the known-workspace list (the payload can
 * no longer echo a bogus id next to another workspace's experiment data).
 */
export async function GET(req: NextRequest) {
  const { ws, error } = resolveWorkspace(req)
  if (error) return error
  return NextResponse.json(getExperiments(ws))
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
