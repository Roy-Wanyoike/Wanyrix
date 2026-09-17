import { NextRequest, NextResponse } from 'next/server'
import { buildWorkspaceJsonReport, buildWorkspaceReport } from '@/lib/wanyrix/report'

/**
 * Workspace report — server-assembled "wanyrix report" built from the same
 * getters the other /api/wanyrix/* routes serve. Two flavors (round 10),
 * mirroring the CLI contract:
 *  - `format=markdown` (default) → { filename, markdown, bytes }
 *  - `format=json`               → { filename, json, bytes }   (`--json` parity)
 * Both return JSON envelopes so the client can trigger a named download +
 * toast the size.
 */
export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get('ws') ?? 'helios-platform'
  const format = req.nextUrl.searchParams.get('format') ?? 'markdown'

  if (format === 'json') {
    return NextResponse.json(buildWorkspaceJsonReport(ws))
  }
  if (format === 'markdown') {
    return NextResponse.json(buildWorkspaceReport(ws))
  }
  return NextResponse.json({ error: `unknown format '${format}' (markdown | json)` }, { status: 400 })
}
