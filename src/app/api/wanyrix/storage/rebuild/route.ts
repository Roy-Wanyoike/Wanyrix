import { NextResponse } from 'next/server'
import { rebuildCaches } from '@/lib/wanyrix/storage-state'

/** POST /api/wanyrix/storage/rebuild — simulate scans repopulating the caches. */
export async function POST() {
  return NextResponse.json(rebuildCaches())
}
