import { NextResponse } from 'next/server'
import { DIAGNOSTICS } from '@/lib/ferrix/data'

export async function GET() {
  return NextResponse.json(DIAGNOSTICS)
}
