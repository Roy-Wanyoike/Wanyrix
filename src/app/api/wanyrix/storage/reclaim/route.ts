import { NextResponse } from 'next/server'
import { reclaimCaches } from '@/lib/wanyrix/storage-state'

/** POST /api/wanyrix/storage/reclaim — the real mutation behind the dialog CTA. */
export async function POST() {
  return NextResponse.json(reclaimCaches())
}
