import { NextResponse } from 'next/server'
import { rebuildCaches } from '@/lib/ferrix/storage-state'

/** POST /api/ferrix/storage/rebuild — simulate scans repopulating the caches. */
export async function POST() {
  return NextResponse.json(rebuildCaches())
}
