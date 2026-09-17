import type { StoragePayload, StorageRow } from '@/lib/ferrix/types'

/**
 * Server-side storage state for `ferrix storage` (Gate 71.10) — in-process,
 * simulated telemetry. Shared by GET /api/ferrix/storage and the real
 * reclaim mutation at POST /api/ferrix/storage/reclaim.
 *
 * Model:
 * - Non-reclaimable rows (database, indexes, artifacts) are constant.
 * - Reclaimable rows (analysis cache, logs) regrow INCREMENTALLY after a GC
 *   (analysis ~0.8 MB/min, logs ~0.05 MB/min) up to their baseline, so the
 *   report stays alive and the bound is observable. Regrowth is simulated
 *   and labeled as such in the UI.
 *
 * IMPORTANT: Next.js compiles each route into its own server bundle, so
 * plain module-level state is NOT shared between /storage and /storage/reclaim
 * in dev. The mutable state therefore lives on `globalThis` (a documented
 * Next.js singleton pattern) so both routes mutate the same store.
 */

type RowState = { base: number; current: number; reclaimable: boolean }

interface StorageGcState {
  rows: Record<string, RowState>
  lastGcMs: number
  /** timestamp of the last regrowth application (incremental model) */
  lastAppliedMs: number
  reclaimedTotalMB: number
}

const REGROW_PER_MIN: Record<string, number> = {
  'Analysis cache (reusable regions)': 0.8,
  'Logs (structured, 14-day retention)': 0.05,
}

function freshRows(): Record<string, RowState> {
  return {
    'Database (SQLite · F-EIR snapshots)': { base: 412, current: 412, reclaimable: false },
    'Indexes (symbols, graph, git map)': { base: 88, current: 88, reclaimable: false },
    'Artifact cache (target analyses)': { base: 640, current: 640, reclaimable: false },
    'Analysis cache (reusable regions)': { base: 96, current: 96, reclaimable: true },
    'Logs (structured, 14-day retention)': { base: 12, current: 12, reclaimable: true },
  }
}

/** globalThis singleton — survives per-route bundle duplication. */
const KEY = '__ferrix_storage_state__'
function getState(): StorageGcState {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[KEY]) {
    const now = Date.now()
    g[KEY] = {
      rows: freshRows(),
      lastGcMs: Date.parse('2026-09-17T03:40:00Z'),
      lastAppliedMs: now,
      reclaimedTotalMB: 0,
    } satisfies StorageGcState
  }
  return g[KEY] as StorageGcState
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Apply incremental regrowth for reclaimable rows, then build the payload. */
export function storagePayload(now = Date.now()): StoragePayload {
  const s = getState()
  const deltaMin = Math.max(0, (now - s.lastAppliedMs) / 60000)
  if (deltaMin > 0) {
    for (const [label, r] of Object.entries(s.rows)) {
      const rate = REGROW_PER_MIN[label] ?? 0
      if (r.reclaimable && rate > 0) {
        r.current = Math.min(r.base, r.current + deltaMin * rate)
      }
    }
    s.lastAppliedMs = now
  }
  const rows: StorageRow[] = Object.entries(s.rows).map(([label, r]) => {
    const reclaimedRecently = r.reclaimable && r.current < r.base * 0.5
    return {
      label,
      sizeMB: round1(r.current),
      note: r.reclaimable
        ? reclaimedRecently
          ? 'reclaimed — regrows as ferrix scans and writes (simulated)'
          : 'safe to reclaim — rebuilt on next scan'
        : label.startsWith('Database')
          ? 'WAL mode · integrity_check OK'
          : label.startsWith('Indexes')
            ? 'incrementally maintained'
            : 'LRU-bounded, hard cap 2 GB',
      reclaimable: r.reclaimable,
    }
  })
  return {
    rows,
    totalMB: round1(rows.reduce((acc, r) => acc + r.sizeMB, 0)),
    lastGc: new Date(s.lastGcMs).toISOString(),
    retention: 'snapshots 90d · logs 14d · artifacts LRU 2 GB cap',
    bound: 'no unbounded temporary storage · no silent cache growth',
    reclaimedTotalMB: round1(s.reclaimedTotalMB),
    sinceGcMin: Math.floor(Math.max(0, (now - s.lastGcMs) / 60000)),
  }
}

/** Reclaim every reclaimable row — the real mutation behind the dialog CTA. */
export function reclaimCaches(now = Date.now()): {
  reclaimedMB: number
  detail: string[]
  storage: StoragePayload
} {
  const s = getState()
  // fold pending regrowth into `current` before zeroing, so the freed amount
  // matches exactly what GET would have reported
  storagePayload(now)
  let reclaimedMB = 0
  const detail: string[] = []
  for (const [label, r] of Object.entries(s.rows)) {
    if (r.reclaimable && r.current > 0) {
      reclaimedMB += r.current
      detail.push(`${label}: ${round1(r.current)} MB freed`)
      r.current = 0
    }
  }
  s.lastGcMs = now
  s.lastAppliedMs = now
  s.reclaimedTotalMB += reclaimedMB
  return {
    reclaimedMB: round1(reclaimedMB),
    detail,
    storage: storagePayload(now),
  }
}
