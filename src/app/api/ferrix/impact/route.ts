import { NextRequest, NextResponse } from 'next/server'
import { getImpact } from '@/lib/ferrix/data'

/**
 * Engineering cost calculator (simulated by the Ferrix engine fixture data).
 * Every response is explicitly labeled `estimated` — never `measured` —
 * until an experiment verifies it (Gate 21 / Gate 10).
 */
export async function GET(req: NextRequest) {
  const type = (req.nextUrl.searchParams.get('type') ?? 'add-dep') as
    | 'add-dep'
    | 'edit-file'
    | 'split-crate'
    | string
  const target = req.nextUrl.searchParams.get('target') ?? ''
  const ws = req.nextUrl.searchParams.get('ws') ?? 'helios-platform'

  if (type !== 'add-dep' && type !== 'edit-file' && type !== 'split-crate') {
    return NextResponse.json({ error: `unknown type '${type}'` }, { status: 400 })
  }

  const payload = getImpact(type, target, ws)
  if (!payload) {
    return NextResponse.json({ error: `unknown target '${target}'` }, { status: 404 })
  }
  return NextResponse.json(payload)
}
