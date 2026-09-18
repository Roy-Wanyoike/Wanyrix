import { NextRequest, NextResponse } from 'next/server'
import { buildWorkspaceJsonReport, buildWorkspaceReport } from '@/lib/wanyrix/report'
import { notAllowedOnGetOnly, resolveWorkspace } from '@/lib/wanyrix/api'

/**
 * Workspace report — server-assembled "wanyrix report" built from the same
 * getters the other /api/wanyrix/* routes serve. Two flavors (round 10),
 * mirroring the CLI contract:
 *  - `format=markdown` (default) → { filename, markdown, bytes, schema }  (`wanyrix.markdown/v1` envelope — ENG-TCA-6d)
 *  - `format=json`               → { filename, json, bytes }              (`wanyrix.report/v1` inner schema)
 * Both return JSON envelopes so the client can trigger a named download +
 * toast the size.
 *
 * ENG-TCA-1: the report refuses to generate for an unknown workspace — a
 * `wanyrix.report/v1` artifact must never carry a `workspace` field that does
 * not match the data inside it.
 */
export async function GET(req: NextRequest) {
  const { ws, error } = resolveWorkspace(req)
  if (error) return error

  const format = req.nextUrl.searchParams.get('format') ?? 'markdown'

  if (format === 'json') {
    return NextResponse.json(buildWorkspaceJsonReport(ws))
  }
  if (format === 'markdown') {
    return NextResponse.json(buildWorkspaceReport(ws))
  }
  return NextResponse.json({ error: `unknown format '${format}' (markdown | json)` }, { status: 400 })
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
