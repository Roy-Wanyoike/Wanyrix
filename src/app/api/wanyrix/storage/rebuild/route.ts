import { NextResponse } from 'next/server'
import { rebuildCaches } from '@/lib/wanyrix/storage-state'
import { notAllowedOnPostOnly } from '@/lib/wanyrix/api'

/** POST /api/wanyrix/storage/rebuild — simulate scans repopulating the caches. */
export async function POST() {
  return NextResponse.json(rebuildCaches())
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { GET, PUT, DELETE, PATCH } = notAllowedOnPostOnly
export { GET, PUT, DELETE, PATCH }
