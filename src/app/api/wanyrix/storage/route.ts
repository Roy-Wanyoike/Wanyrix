import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { storagePayload } from '@/lib/wanyrix/storage-state'
import { notAllowedOnGetOnly } from '@/lib/wanyrix/api'

/** Local storage report (Gate 71.10 — bounded, inspectable disk usage). */
export async function GET(_req: NextRequest) {
  return NextResponse.json(storagePayload())
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
