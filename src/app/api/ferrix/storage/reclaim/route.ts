import { NextResponse } from 'next/server'
import { reclaimCaches } from '@/lib/ferrix/storage-state'

/** POST /api/ferrix/storage/reclaim — the real mutation behind the dialog CTA. */
export async function POST() {
  return NextResponse.json(reclaimCaches())
}
