import { NextRequest, NextResponse } from 'next/server'
import { getExperiments } from '@/lib/ferrix/data'

export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get('ws') ?? 'helios-platform'
  return NextResponse.json(getExperiments(ws))
}
