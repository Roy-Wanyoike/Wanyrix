import { NextRequest, NextResponse } from 'next/server'
import { buildWorkspaceJsonReport, buildWorkspaceReport } from '@/lib/wanyrix/report'
import { buildScorecardBundle, buildScanHistoryBundle } from '@/lib/wanyrix/flavors'
import { notAllowedOnGetOnly, resolveWorkspace } from '@/lib/wanyrix/api'

/**
 * Workspace report — server-assembled "wanyrix report" built from the same
 * getters the other /api/wanyrix/* routes serve. Two formats (round 10),
 * mirroring the CLI contract:
 *  - `format=markdown` (default) → { filename, markdown, bytes, schema }  (`wanyrix.markdown/v1` envelope — ENG-TCA-6d)
 *  - `format=json`               → { filename, json, bytes }              (`wanyrix.report/v1` inner schema)
 * Both return JSON envelopes so the client can trigger a named download +
 * toast the size.
 *
 * Machine flavors (ENG-TCA-2) — the two previously client-only versioned
 * schemas are now fetchable over HTTP via the additive `flavor` param:
 *  - `flavor=scorecard`    → { filename, json, bytes } (`wanyrix.release-scorecard/v1`)
 *  - `flavor=scan-history` → { filename, json, bytes } (`wanyrix.scan-history/v1`)
 * A valid `flavor` takes precedence over `format`; an unknown `flavor` is a
 * 400. The default flavor remains the workspace report — existing consumers
 * are unaffected.
 *
 * ENG-TCA-1: the report refuses to generate for an unknown workspace — a
 * `wanyrix.report/v1` artifact must never carry a `workspace` field that does
 * not match the data inside it.
 */
export async function GET(req: NextRequest) {
  const { ws, error } = resolveWorkspace(req)
  if (error) return error

  const flavor = req.nextUrl.searchParams.get('flavor')
  if (flavor === 'scorecard') {
    return NextResponse.json(buildScorecardBundle())
  }
  if (flavor === 'scan-history') {
    return NextResponse.json(buildScanHistoryBundle(ws))
  }
  if (flavor) {
    return NextResponse.json(
      { error: `unknown flavor '${flavor}' (scorecard | scan-history)` },
      { status: 400 },
    )
  }

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
