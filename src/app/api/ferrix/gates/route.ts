import { NextResponse } from 'next/server'
import { GATES } from '@/lib/ferrix/data'

export async function GET() {
  return NextResponse.json(GATES)
}
