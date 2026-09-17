import { NextResponse } from 'next/server'
import { GRAPH_NODES, GRAPH_EDGES, DUPLICATES, BLAST, WORKSPACE } from '@/lib/ferrix/data'
import type { GraphPayload } from '@/lib/ferrix/types'

export async function GET() {
  const payload: GraphPayload = {
    nodes: GRAPH_NODES,
    edges: GRAPH_EDGES,
    duplicates: DUPLICATES,
    blast: BLAST,
    meta: {
      workspaceCrates: WORKSPACE.crates,
      totalEdges: WORKSPACE.edges,
      lastScan: WORKSPACE.lastScan,
    },
  }
  return NextResponse.json(payload)
}
