import { NextResponse } from 'next/server'
import { HEALTH } from '@/lib/ferrix/data'

export async function GET() {
  return NextResponse.json(HEALTH)
}
