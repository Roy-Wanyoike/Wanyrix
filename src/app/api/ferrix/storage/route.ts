import { NextResponse } from 'next/server'
import { storagePayload } from '@/lib/ferrix/storage-state'

export async function GET() {
  return NextResponse.json(storagePayload())
}
