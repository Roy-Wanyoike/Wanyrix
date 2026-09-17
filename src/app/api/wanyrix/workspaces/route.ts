import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaces } from '@/lib/wanyrix/data'

/** Workspace registry backing the topbar switcher (issue #34). */
export async function GET(_req: NextRequest) {
  return NextResponse.json(getWorkspaces())
}
