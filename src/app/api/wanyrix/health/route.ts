import { NextRequest, NextResponse } from 'next/server'
import { getHealth } from '@/lib/wanyrix/data'
import { notAllowedOnGetOnly, resolveWorkspace } from '@/lib/wanyrix/api'

/**
 * GET /api/wanyrix/health?ws= — workspace overview payload.
 * ENG-TCA-1: unknown `ws` → 404 with the known-workspace list.
 * Issue #129: the `?workspace=` alias is accepted too, and an unknown id
 * under EITHER spelling 404s — the spelling is never silently ignored
 * (it used to read only `ws`, so `?workspace=<unknown>` leaked the default
 * workspace's data as a bogus "healthy" answer).
 */
export async function GET(req: NextRequest) {
  const { ws, error } = resolveWorkspace(req)
  if (error) return error
  return NextResponse.json(getHealth(ws))
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
