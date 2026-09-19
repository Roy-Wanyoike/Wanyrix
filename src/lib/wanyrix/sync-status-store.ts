'use client'

import { create } from 'zustand'

/**
 * Ephemeral scan-run sync status (session-only, deliberately NOT persisted).
 *
 * The durable truth lives in two places by design:
 *   1. the browser-local run log (scan-store.ts `runs`, persisted) and
 *   2. the server log (`GET /api/wanyrix/scan-runs`, SQLite) — a run that
 *      appears there is synced, period, even across sessions.
 *
 * This store only tracks the IN-FLIGHT outcome of this session's fire-and-
 * forget POSTs ('pending' → 'synced' | 'failed') so the UI can show live
 * feedback. It is kept OUT of the persisted scan-store envelope on purpose:
 * that envelope's key set is pinned by tests/unit/scan-runs.test.ts and any
 * persistent sync state would go stale anyway — the server log itself is the
 * cross-session source of truth (a page reload re-derives everything from
 * `useServerScanRuns()`).
 */

export type ScanRunSyncState = 'pending' | 'synced' | 'failed'

interface SyncStatusState {
  status: Record<string, ScanRunSyncState>
  markPending: (id: string) => void
  markSynced: (id: string) => void
  markFailed: (id: string) => void
}

export const useSyncStatusStore = create<SyncStatusState>()((set) => ({
  status: {},
  markPending: (id) => set((s) => ({ status: { ...s.status, [id]: 'pending' } })),
  markSynced: (id) => set((s) => ({ status: { ...s.status, [id]: 'synced' } })),
  markFailed: (id) => set((s) => ({ status: { ...s.status, [id]: 'failed' } })),
}))
