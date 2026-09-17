'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Doctor scan wiring + history (issue #37).
 *
 * `scanTick` is the global "run a scan" event: the topbar Run-scan button and
 * the command palette bump it, and the doctor view reacts (event-driven wiring
 * instead of per-view client state). Every completed scan — topbar-triggered
 * or run from the doctor view itself — appends a history entry, persisted per
 * workspace (localStorage, capped at 20 entries per workspace).
 *
 * Figures for each entry come from the doctor payload at completion time;
 * the wall-clock duration is measured in the browser and labeled as such.
 */

export type ScanTrigger = 'manual' | 'topbar' | 'palette'

export interface ScanHistoryEntry {
  id: string
  workspace: string
  at: number // epoch ms
  durationMs: number // client-measured wall clock of the terminal replay
  findings: number
  critical: number
  warning: number
  info: number
  buildTime: number // s, measured (payload)
  estimatedFrom: number // s, estimated (payload)
  estimatedTo: number // s, estimated (payload)
  trigger: ScanTrigger
}

const CAP = 20

interface ScanState {
  scanTick: number
  lastTrigger: ScanTrigger
  bumpScan: (trigger: ScanTrigger) => void
  history: Record<string, ScanHistoryEntry[]>
  addEntry: (ws: string, entry: ScanHistoryEntry) => void
  clearHistory: (ws: string) => void
}

export const useScanStore = create<ScanState>()(
  persist(
    (set) => ({
      scanTick: 0,
      lastTrigger: 'manual',
      bumpScan: (trigger) =>
        set((s) => ({
          scanTick: s.scanTick + 1,
          lastTrigger: trigger,
        })),
      history: {},
      addEntry: (ws, entry) =>
        set((s) => {
          const list = [entry, ...(s.history[ws] ?? [])].slice(0, CAP)
          return { history: { ...s.history, [ws]: list } }
        }),
      clearHistory: (ws) =>
        set((s) => ({ history: { ...s.history, [ws]: [] } })),
    }),
    {
      name: 'ferrix.scan-store',
      partialize: (s) => ({ history: s.history }),
    },
  ),
)
