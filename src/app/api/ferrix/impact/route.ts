import { NextRequest, NextResponse } from 'next/server'
import { ADD_DEP_CATALOG, BLAST, SPLIT_SIM } from '@/lib/ferrix/data'
import type { AddDepImpact, EditFileImpact, SplitImpact } from '@/lib/ferrix/types'

/**
 * Engineering cost calculator (simulated by the Ferrix engine fixture data).
 * Every response is explicitly labeled `estimated` — never `measured` —
 * until an experiment verifies it (Gate 21 / Gate 10).
 */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? 'add-dep'
  const target = req.nextUrl.searchParams.get('target') ?? ''

  if (type === 'add-dep') {
    const entry = ADD_DEP_CATALOG[target]
    if (!entry) {
      return NextResponse.json({ error: `unknown crate '${target}'` }, { status: 404 })
    }
    const payload: AddDepImpact = { kind: 'add-dep', crate: target, ...entry, measurementStatus: 'estimated' }
    return NextResponse.json(payload)
  }

  if (type === 'edit-file') {
    const entry = BLAST.find((b) => b.file === target)
    if (!entry) {
      return NextResponse.json({ error: `unknown file '${target}'` }, { status: 404 })
    }
    const payload: EditFileImpact = {
      kind: 'edit-file',
      file: entry.file,
      crate: entry.crate,
      affectedWorkspace: entry.affectedWorkspace,
      chain: entry.chain,
      incrementalDelta: entry.incrementalDelta,
      ciDelta: Math.round(entry.incrementalDelta * 1.6 * 10) / 10,
      notes: [
        `Blast radius: ${entry.affectedWorkspace} workspace crates re-invalidate`,
        `Chain: ${entry.chain.join(' → ')}`,
        'Estimates derived from build telemetry × graph traversal',
      ],
      suggestion: entry.suggestion,
      measurementStatus: 'estimated',
    }
    return NextResponse.json(payload)
  }

  if (type === 'split-crate') {
    const payload: SplitImpact = {
      kind: 'split-crate',
      source: SPLIT_SIM.source,
      before: SPLIT_SIM.before,
      proposal: SPLIT_SIM.proposal,
      improvementPct: SPLIT_SIM.improvementPct,
      migration: SPLIT_SIM.migration,
      measurementStatus: 'estimated',
    }
    return NextResponse.json(payload)
  }

  return NextResponse.json({ error: `unknown type '${type}'` }, { status: 400 })
}
