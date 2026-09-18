import { NextRequest, NextResponse } from 'next/server'
import { getImpact } from '@/lib/wanyrix/data'
import { notAllowedOnGetOnly, resolveWorkspace } from '@/lib/wanyrix/api'

/**
 * Engineering cost calculator (simulated by the Wanyrix engine fixture data).
 * Every response is explicitly labeled `estimated` — never `measured` —
 * until an experiment verifies it (Gate 21 / Gate 10).
 *
 * Error contract (ENG-TCA-6b): a MISSING required param is a 400 (client
 * input error) while an UNKNOWN target remains the documented 404; an unknown
 * `ws` is a 404 naming the known workspaces (ENG-TCA-1).
 */
export async function GET(req: NextRequest) {
  const { ws, error: wsError } = resolveWorkspace(req)
  if (wsError) return wsError

  const type = (req.nextUrl.searchParams.get('type') ?? 'add-dep') as
    | 'add-dep'
    | 'edit-file'
    | 'split-crate'
    | 'upgrade-dep'
    | string
  const target = req.nextUrl.searchParams.get('target') ?? ''

  if (type !== 'add-dep' && type !== 'edit-file' && type !== 'split-crate' && type !== 'upgrade-dep') {
    return NextResponse.json({ error: `unknown type '${type}'` }, { status: 400 })
  }

  if (target === '') {
    return NextResponse.json(
      { error: "missing required param 'target'" },
      { status: 400 },
    )
  }

  const payload = getImpact(type, target, ws)
  if (!payload) {
    return NextResponse.json({ error: `unknown target '${target}'` }, { status: 404 })
  }
  return NextResponse.json(payload)
}

/** ENG-TCA-6a — 405s carry an Allow header. */
const { POST, PUT, DELETE, PATCH } = notAllowedOnGetOnly
export { POST, PUT, DELETE, PATCH }
