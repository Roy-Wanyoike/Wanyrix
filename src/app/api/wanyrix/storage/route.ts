import { NextResponse } from 'next/server'
import { storagePayload } from '@/lib/wanyrix/storage-state'

export async function GET() {
  return NextResponse.json(storagePayload())
}
