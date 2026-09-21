import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getDiagnostics } from '@/lib/ferrix/data'

export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get('ws') ?? 'helios-platform'
  return NextResponse.json(getDiagnostics(ws))
}
