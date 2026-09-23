import { NextResponse } from 'next/server'
import { reclaimCaches } from '@/lib/wanyrix/storage-state'
import { notAllowedOnPostOnly } from '@/lib/wanyrix/api'
import { withNoStore } from '@/lib/http-hygiene'

/** POST /api/wanyrix/storage/reclaim — the real mutation behind the dialog CTA (#141: no-store). */
export const POST = withNoStore(async function POST() {
  return NextResponse.json(reclaimCaches())
})

/** ENG-TCA-6a — 405s carry an Allow header. */
const { GET, PUT, DELETE, PATCH } = notAllowedOnPostOnly
export { GET, PUT, DELETE, PATCH }
