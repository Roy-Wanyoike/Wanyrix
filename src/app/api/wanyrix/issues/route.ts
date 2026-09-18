import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { ISSUES } from '@/lib/wanyrix/data'
import { notAllowedOnGetOnly } from '@/lib/wanyrix/api'

/** Issues → PRs traceability (Gate 16). */
export async function GET(_req: NextRequest) {
  return NextResponse.json({ issues: ISSUES })
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
