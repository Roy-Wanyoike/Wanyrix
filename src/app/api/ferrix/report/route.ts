import { NextRequest, NextResponse } from 'next/server'
import { buildWorkspaceReport } from '@/lib/ferrix/report'

/**
 * Workspace report (round 9) — server-assembled Markdown "ferrix report"
 * built from the same getters the other /api/ferrix/* routes serve.
 * Returns JSON so the client can trigger a named download + toast the size.
 */
export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get('ws') ?? 'helios-platform'
  const bundle = buildWorkspaceReport(ws)
  return NextResponse.json(bundle)
}
