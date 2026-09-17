import { NextResponse } from 'next/server'
import { DOCTOR } from '@/lib/ferrix/data'

export async function GET() {
  return NextResponse.json(DOCTOR)
}
