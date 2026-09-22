import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  WORKSPACE_IDS,
  notAllowedOnGetOnly,
  resolveWorkspace,
  workspaceParam,
} from '@/lib/wanyrix/api'
import { getPRAnalysis } from '@/lib/wanyrix/data'
import { isRegisteredWorkspaceId } from '@/lib/wanyrix/register'
import { RegisteredStoreError, findRegisteredWorkspace } from '@/lib/wanyrix/registered-scan'

/**
 * GET /api/wanyrix/pr?ws= — the workspace's featured PR build-regression case.
 * ENG-TCA-1: unknown `ws` → 404 with the known-workspace list.
 *
 * QA-5-B-1: a REGISTERED local project gets a NAMED refusal (still 404 —
 * no PR payload exists to serve and none may be fabricated): the error says
 * the PR surface is fixture-backed and points at the REAL engine surfaces
 * that do serve this project (git / what-changed / engine/doctor). The view
 * renders the message — the 404 is never silent.
 */
export async function GET(req: NextRequest) {
  const raw = workspaceParam(req)
  if (raw !== null && isRegisteredWorkspaceId(raw)) {
    try {
      const row = await findRegisteredWorkspace(raw)
      if (row) {
        return NextResponse.json(
          {
            error: `no PR analysis exists for the registered local project '${row.name}' — the Issues & PRs surface is fixture-backed demo data`,
            hint: 'real change surfaces for this project: GET /api/wanyrix/git?ws=<id> · GET /api/wanyrix/what-changed?ws=<id> · GET /api/wanyrix/engine/doctor?ws=<id>',
            knownWorkspaces: WORKSPACE_IDS,
          },
          { status: 404 },
        )
      }
    } catch (err) {
      // store down → the id cannot be resolved; fall through to the standard
      // fixture 404 (never a 500 on the read path)
      if (!(err instanceof RegisteredStoreError)) throw err
      console.error('[pr] registered-workspace store unavailable')
    }
    // unknown ws-local-* id falls through to the standard 404 below
  }
  const { ws, error } = resolveWorkspace(req)
  if (error) return error
  return NextResponse.json(getPRAnalysis(ws))
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
