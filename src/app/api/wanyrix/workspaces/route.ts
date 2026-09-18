import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getWorkspaces } from '@/lib/wanyrix/data'
import { notAllowedOnGetOnly } from '@/lib/wanyrix/api'

/** Workspace registry backing the topbar switcher (issue #34). */
export async function GET(_req: NextRequest) {
  return NextResponse.json(getWorkspaces())
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
