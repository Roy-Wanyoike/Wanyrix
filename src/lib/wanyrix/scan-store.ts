'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { createMigratingStorage } from './legacy-migration'

/**
 * Doctor scan wiring + history (issue #37) + scan-run recording (Task 3-b).
 *
 * `scanTick` is the global "run a scan" event: the topbar Run-scan button and
 * the command palette bump it, and the doctor view reacts (event-driven wiring
 * instead of per-view client state). Every completed scan — topbar-triggered
 * or run from the doctor view itself — appends a history entry, persisted per
 * workspace (localStorage, capped at 20 entries per workspace).
 *
 * Figures for each entry come from the doctor payload at completion time;
 * the wall-clock duration is measured in the browser and labeled as such.
 *
 * Task 3-b (additive): `recordScanRun` persists a structured SCAN RUN per
 * workspace — same zustand persist + legacy-migration storage layer, same
 * `wanyrix.scan-store` key, capped at 50 runs (oldest evicted) with
 * deterministic ids (`run-<count>-<startedAt>`). The UI trigger wiring is
 * owned by the component layer; this module only exposes the store API
 * (`recordScanRun`) + the `useRecordScanRun()` hook in hooks.ts (which also
 * fire-and-forget syncs each run to the durable server log,
 * `GET/POST /api/wanyrix/scan-runs` → `wanyrix.scan-runs/v1` — see hooks.ts).
 * Server-side, the `wanyrix.scan-history/v1` EXPORT flavor stays honestly
 * EMPTY — these local runs are per-browser data and are never fabricated into
 * that HTTP response (see flavors.ts); the durable server log only ever
 * contains runs the client explicitly POSTed.
 */

/**
 * Where a run originated. `engine-exec` (R8) marks runs measured by the REAL
 * wanyrix binary via `/api/wanyrix/engine/*` — their findings carry the
 * engine's own `FER-ENG-*` id registry, so they are visually distinct from
 * demo-replay runs (`WAN-*` ids) in every history surface.
 */
export type ScanTrigger = 'manual' | 'topbar' | 'palette' | 'engine-exec'

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
  /**
   * R8 (additive, honesty): present ONLY on rows whose build time is a
   * visible zero rather than a measured figure — `engine-exec` runs record
   * the REAL binary's doctor scan, which deliberately measures no build
   * time (Gate 21: a fake 0.0s "measured" would be an estimate in
   * disguise). Legacy/demo rows omit the key (build time is measured).
   */
  buildTimeStatus?: 'measured' | 'not-measured'
  /**
   * Findings fingerprint (R7): the sorted unique finding ids this run's
   * payload contained — OPTIONAL. The key is only present when a payload
   * supplied one (legacy persisted entries predate it), and it is capped at
   * `FINDING_IDS_CAP` (see finding-diff.ts) with `findingIdsTruncated` set
   * when the source list overflowed.
   */
  findingIds?: string[]
  findingIdsTruncated?: boolean
}

const CAP = 20

/* ------------------------------------------- scan-run recording (Task 3-b) */

/** Per-severity finding tallies of a completed scan run. */
export interface ScanSeverityCounts {
  critical: number
  warning: number
  info: number
}

/**
 * One recorded scan run, persisted per workspace. Shape pinned by
 * tests/unit/scan-runs.test.ts and mirrored (key-for-key) by the run-entry
 * contract documented in the `wanyrix.scan-history/v1` flavor note.
 */
export interface ScanRunRecord {
  id: string
  workspaceId: string
  startedAt: number // epoch ms — scan start
  finishedAt: number // epoch ms — scan completion
  durationMs: number // measured wall clock (finishedAt − startedAt)
  findingCount: number
  severityCounts: ScanSeverityCounts
  trigger: ScanTrigger
  /**
   * Findings fingerprint (R7) — OPTIONAL, key omitted when absent so the
   * pinned legacy record shape stays byte-compatible. Same cap/truncation
   * contract as `ScanHistoryEntry.findingIds`; synced verbatim to the
   * durable server log (`wanyrix.scan-runs/v1`).
   */
  findingIds?: string[]
  findingIdsTruncated?: boolean
}

/**
 * What a caller must provide: the measured figures. `id` is assigned
 * deterministically by the store (pass one only to replay/migrate an exact
 * run); `durationMs` defaults to `finishedAt − startedAt`; `trigger`
 * defaults to `'manual'`.
 */
export type ScanRunInput = Partial<
    Pick<ScanRunRecord, 'id' | 'durationMs' | 'trigger' | 'findingIds' | 'findingIdsTruncated'>
  > &
  Omit<ScanRunRecord, 'id' | 'durationMs' | 'trigger' | 'findingIds' | 'findingIdsTruncated'>

/** Max persisted scan runs per workspace (oldest evicted). */
export const SCAN_RUNS_CAP = 50

/** Deterministic run id: `run-<count>-<startedAt>` (count = per-ws sequence). */
export function scanRunId(count: number, startedAt: number): string {
  return `run-${count}-${startedAt}`
}

interface ScanState {
  scanTick: number
  lastTrigger: ScanTrigger
  bumpScan: (trigger: ScanTrigger) => void
  history: Record<string, ScanHistoryEntry[]>
  addEntry: (ws: string, entry: ScanHistoryEntry) => void
  clearHistory: (ws: string) => void
  /** persisted scan runs per workspace (newest first), Task 3-b */
  runs: Record<string, ScanRunRecord[]>
  /** per-workspace monotonic counter backing deterministic run ids */
  runSeq: Record<string, number>
  /** record a completed scan run (called at scan completion; UI-owned trigger) */
  recordScanRun: (run: ScanRunInput) => ScanRunRecord
  /** clear the recorded runs of one workspace */
  clearScanRuns: (workspaceId: string) => void
  /* ------------------------------------------------ issue #99: run lifecycle */
  /**
   * True while a doctor-scan run triggered OUTSIDE the doctor view (topbar
   * button / ⌘K palette) is in flight. Drives the topbar Run-scan loading
   * state — the doctor view's own replay does not touch it (the terminal IS
   * its loading state). EPHEMERAL: never persisted (excluded below).
   */
  runInFlight: boolean
  /** mark a shell-triggered run as started (idempotent while in flight) */
  startShellScanRun: () => void
  /** mark the shell-triggered run as finished (fetch done / recorded / failed) */
  finishShellScanRun: () => void
  /**
   * scanTick of the last run whose history entry + scan-run record were
   * already written. Both recorders (app shell for topbar/⌘K runs, doctor
   * view for its own button + auto-run) call {@link claimRunRecording} so a
   * single scan event is recorded EXACTLY once no matter which component
   * observes its completion. EPHEMERAL: never persisted.
   */
  lastRecordedTick: number
  /**
   * Returns true when the CALLER owns recording `tick` (first caller wins);
   * false when the tick was already recorded by the other recorder.
   */
  claimRunRecording: (tick: number) => boolean
}

export const useScanStore = create<ScanState>()(
  persist(
    (set, get) => ({
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
      runs: {},
      runSeq: {},
      /* issue #99: shell-run loading state — ephemeral, never persisted */
      runInFlight: false,
      startShellScanRun: () => {
        if (get().runInFlight) return
        set({ runInFlight: true })
      },
      finishShellScanRun: () => {
        if (!get().runInFlight) return
        set({ runInFlight: false })
      },
      lastRecordedTick: -1,
      claimRunRecording: (tick) => {
        if (tick <= get().lastRecordedTick) return false
        set({ lastRecordedTick: tick })
        return true
      },
      recordScanRun: (run) => {
        const ws = run.workspaceId
        const seq = (get().runSeq[ws] ?? 0) + 1
        const record: ScanRunRecord = {
          id: run.id ?? scanRunId(seq, run.startedAt),
          workspaceId: ws,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: run.durationMs ?? Math.max(0, run.finishedAt - run.startedAt),
          findingCount: run.findingCount,
          severityCounts: run.severityCounts,
          trigger: run.trigger ?? 'manual',
        }
        // R7: fingerprint keys are included ONLY when provided — legacy
        // replays/migrations without one keep the exact pinned 8-key shape.
        if (run.findingIds !== undefined) {
          record.findingIds = run.findingIds
          if (run.findingIdsTruncated) record.findingIdsTruncated = true
        }
        set((s) => ({
          runs: {
            ...s.runs,
            // newest first; cap 50 — the oldest runs fall off the tail
            [ws]: [record, ...(s.runs[ws] ?? [])].slice(0, SCAN_RUNS_CAP),
          },
          // monotonic even past the cap, so ids never repeat after eviction
          runSeq: { ...s.runSeq, [ws]: Math.max(seq, s.runSeq[ws] ?? 0) },
        }))
        return record
      },
      clearScanRuns: (workspaceId) =>
        set((s) => ({ runs: { ...s.runs, [workspaceId]: [] } })),
    }),
    {
      name: 'wanyrix.scan-store',
      // Task 3-b: runs + runSeq join the same persisted envelope (additive;
      // older persisted payloads without them hydrate to the defaults above).
      partialize: (s) => ({ history: s.history, runs: s.runs, runSeq: s.runSeq }),
      // Pass the thunk (not its result) — see workspace-store note.
      storage: createJSONStorage(createMigratingStorage),
    },
  ),
)
