import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getPRAnalysis } from '@/lib/ferrix/data'

/** GET /api/ferrix/pr?ws= — the workspace's featured PR build-regression case. */
export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get('ws') ?? 'helios-platform'
  return NextResponse.json(getPRAnalysis(ws))
}
