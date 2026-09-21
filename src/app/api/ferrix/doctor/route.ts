import { NextRequest, NextResponse } from 'next/server'
import { getDoctor } from '@/lib/ferrix/data'

export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get('ws') ?? 'helios-platform'
  return NextResponse.json(getDoctor(ws))
}
