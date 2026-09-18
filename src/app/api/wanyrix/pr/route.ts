import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getPRAnalysis } from '@/lib/wanyrix/data'
import { notAllowedOnGetOnly, resolveWorkspace } from '@/lib/wanyrix/api'

/**
 * GET /api/wanyrix/pr?ws= — the workspace's featured PR build-regression case.
 * ENG-TCA-1: unknown `ws` → 404 with the known-workspace list.
 */
export async function GET(req: NextRequest) {
  const { ws, error } = resolveWorkspace(req)
  if (error) return error
  return NextResponse.json(getPRAnalysis(ws))
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
