import { NextRequest, NextResponse } from 'next/server'
import { getHealth } from '@/lib/wanyrix/data'
import { notAllowedOnGetOnly, resolveWorkspace } from '@/lib/wanyrix/api'

/**
 * GET /api/wanyrix/health?ws= — workspace overview payload.
 * ENG-TCA-1: unknown `ws` → 404 with the known-workspace list.
 */
export async function GET(req: NextRequest) {
  const { ws, error } = resolveWorkspace(req)
  if (error) return error
  return NextResponse.json(getHealth(ws))
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
