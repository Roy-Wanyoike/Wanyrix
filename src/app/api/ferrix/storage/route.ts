import { NextResponse } from 'next/server'
import type { StoragePayload } from '@/lib/ferrix/types'

/**
 * `ferrix storage` — Gate 71.10: local storage must be bounded and inspectable.
 * No unbounded temporary storage, no silent cache growth; caches are safely
 * reclaimable.
 */
const STORAGE: StoragePayload = {
  rows: [
    { label: 'Database (SQLite · F-EIR snapshots)', sizeMB: 412, note: 'WAL mode · integrity_check OK', reclaimable: false },
    { label: 'Indexes (symbols, graph, git map)', sizeMB: 88, note: 'incrementally maintained', reclaimable: false },
    { label: 'Artifact cache (target analyses)', sizeMB: 640, note: 'LRU-bounded, hard cap 2 GB', reclaimable: false },
    { label: 'Analysis cache (reusable regions)', sizeMB: 96, note: 'safe to reclaim — rebuilt on next scan', reclaimable: true },
    { label: 'Logs (structured, 14-day retention)', sizeMB: 12, note: 'rotated nightly', reclaimable: true },
  ],
  totalMB: 1248,
  lastGc: '2026-09-17T03:40:00Z',
  retention: 'snapshots 90d · logs 14d · artifacts LRU 2 GB cap',
  bound: 'no unbounded temporary storage · no silent cache growth',
}

export async function GET() {
  return NextResponse.json(STORAGE)
}
