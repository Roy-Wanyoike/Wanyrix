import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { GATES } from '@/lib/wanyrix/data'
import { notAllowedOnGetOnly } from '@/lib/wanyrix/api'

/** Release scorecard (Gates 1..20 consolidated). */
export async function GET(_req: NextRequest) {
  return NextResponse.json(GATES)
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
