'use client'

import { useCallback, useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient, UseMutationResult } from '@tanstack/react-query'
import type {
  DiagnosticsPayload,
  DoctorReport,
  ExplainRequest,
  ExplainResponse,
  GatesPayload,
  GraphPayload,
  HealthPayload,
  ImpactPayload,
  IssuesPayload,
  ExperimentsPayload,
  PRAnalysis,
  StoragePayload,
  WorkspaceSummary,
  WorkspacesPayload,
} from './types'
import { useWorkspaceStore } from './workspace-store'
import { useScanStore, type ScanRunInput, type ScanRunRecord } from './scan-store'
import { useSyncStatusStore } from './sync-status-store'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json() as Promise<T>
}

/** The active workspace id — every scoped hook folds it into key + URL. */
function useActiveWorkspace(): string {
  return useWorkspaceStore((s) => s.active)
}

export function useWorkspaces() {
  return useQuery<WorkspacesPayload>({
    queryKey: ['workspaces'],
    queryFn: () => getJson('/api/wanyrix/workspaces'),
    staleTime: Infinity,
  })
}

export function useHealth() {
  const ws = useActiveWorkspace()
  return useQuery<HealthPayload>({
    queryKey: ['health', ws],
    queryFn: () => getJson(`/api/wanyrix/health?ws=${encodeURIComponent(ws)}`),
  })
}

export function useDoctor() {
  const ws = useActiveWorkspace()
  return useQuery<DoctorReport>({
    queryKey: ['doctor', ws],
    queryFn: () => getJson(`/api/wanyrix/doctor?ws=${encodeURIComponent(ws)}`),
  })
}

export function useGraph() {
  const ws = useActiveWorkspace()
  return useQuery<GraphPayload>({
    queryKey: ['graph', ws],
    queryFn: () => getJson(`/api/wanyrix/graph?ws=${encodeURIComponent(ws)}`),
  })
}

export function useDiagnostics() {
  const ws = useActiveWorkspace()
  return useQuery<DiagnosticsPayload>({
    queryKey: ['diagnostics', ws],
    queryFn: () => getJson(`/api/wanyrix/diagnostics?ws=${encodeURIComponent(ws)}`),
  })
}

export function useImpact(type: 'add-dep' | 'edit-file' | 'split-crate' | 'upgrade-dep', target: string) {
  const ws = useActiveWorkspace()
  return useQuery<ImpactPayload>({
    queryKey: ['impact', type, target, ws],
    queryFn: () =>
      getJson(
        `/api/wanyrix/impact?type=${encodeURIComponent(type)}&target=${encodeURIComponent(target)}&ws=${encodeURIComponent(ws)}`,
      ),
    enabled: type === 'split-crate' || target.length > 0,
  })
}

export function useExperiments() {
  const ws = useActiveWorkspace()
  return useQuery<ExperimentsPayload>({
    queryKey: ['experiments', ws],
    queryFn: () => getJson(`/api/wanyrix/experiments?ws=${encodeURIComponent(ws)}`),
  })
}

export function usePRAnalysis() {
  const ws = useActiveWorkspace()
  return useQuery<PRAnalysis>({
    queryKey: ['pr', ws],
    queryFn: () => getJson(`/api/wanyrix/pr?ws=${encodeURIComponent(ws)}`),
    staleTime: Infinity,
  })
}

export function useGates() {
  return useQuery<GatesPayload>({ queryKey: ['gates'], queryFn: () => getJson('/api/wanyrix/gates') })
}

export function useIssues() {
  return useQuery<IssuesPayload>({ queryKey: ['issues'], queryFn: () => getJson('/api/wanyrix/issues') })
}

export function useStorage() {
  return useQuery<StoragePayload>({
    queryKey: ['storage'],
    queryFn: () => getJson('/api/wanyrix/storage'),
    // reclaimable rows regrow server-side — poll so the dialog shows it live
    refetchInterval: 30_000,
  })
}

export interface ReclaimResponse {
  reclaimedMB: number
  detail: string[]
  storage: StoragePayload
}

export function useReclaimCaches(): UseMutationResult<ReclaimResponse, Error, void> {
  const queryClient = useQueryClient()
  return useMutation<ReclaimResponse, Error, void>({
    mutationFn: async () => {
      const res = await fetch('/api/wanyrix/storage/reclaim', { method: 'POST' })
      if (!res.ok) throw new Error(`reclaim → ${res.status}`)
      return res.json() as Promise<ReclaimResponse>
    },
    onSuccess: (data) => {
      // seed the cache with the server's post-GC payload, then refetch
      queryClient.setQueryData<StoragePayload>(['storage'], data.storage)
      void queryClient.invalidateQueries({ queryKey: ['storage'] })
    },
  })
}

export interface RebuildResponse {
  rebuiltMB: number
  detail: string[]
  storage: StoragePayload
}

export function useRebuildCaches(): UseMutationResult<RebuildResponse, Error, void> {
  const queryClient = useQueryClient()
  return useMutation<RebuildResponse, Error, void>({
    mutationFn: async () => {
      const res = await fetch('/api/wanyrix/storage/rebuild', { method: 'POST' })
      if (!res.ok) throw new Error(`rebuild → ${res.status}`)
      return res.json() as Promise<RebuildResponse>
    },
    onSuccess: (data) => {
      queryClient.setQueryData<StoragePayload>(['storage'], data.storage)
      void queryClient.invalidateQueries({ queryKey: ['storage'] })
    },
  })
}

export function useExplain(): UseMutationResult<ExplainResponse, Error, ExplainRequest> {
  return useMutation<ExplainResponse, Error, ExplainRequest>({
    mutationFn: async (body) => {
      const res = await fetch('/api/wanyrix/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`explain → ${res.status}`)
      return res.json() as Promise<ExplainResponse>
    },
  })
}

/* ------------------------------------------------- workspace report export */

export interface ReportBundle {
  /** envelope schema marker (`wanyrix.markdown/v1` — ENG-TCA-6d) */
  schema?: string
  filename: string
  markdown: string
  bytes: number
}

export interface ReportJsonBundle {
  filename: string
  json: unknown
  bytes: number
}

export type ReportFormat = 'markdown' | 'json'

/**
 * Exports the server-assembled workspace report and triggers a browser
 * download. `markdown` is the human-readable flavor; `json` mirrors the CLI
 * `--json` contract (round 10). Mutation state drives the topbar spinner.
 */
export function useReportExport(format: ReportFormat = 'markdown') {
  const ws = useActiveWorkspace()
  return useMutation<ReportBundle | ReportJsonBundle, Error, void>({
    mutationFn: async () => {
      const res = await fetch(
        `/api/wanyrix/report?ws=${encodeURIComponent(ws)}&format=${format}`,
      )
      if (!res.ok) throw new Error(`report → ${res.status}`)
      const bundle = (await res.json()) as ReportBundle | ReportJsonBundle
      const { downloadText } = await import('./patch')
      if ('markdown' in bundle) downloadText(bundle.filename, bundle.markdown)
      else downloadText(bundle.filename, JSON.stringify(bundle.json, null, 2))
      return bundle
    },
  })
}

/* ----------------------------------------------------- durable server log */

/** One persisted run in the server-side durable log (`wanyrix.scan-runs/v1`). */
export interface ServerScanRun {
  id: string
  workspaceId: string
  startedAt: number
  finishedAt: number
  durationMs: number
  findingCount: number
  severityCounts: { critical: number; warning: number; info: number }
  trigger: string
  syncedAt: string // ISO — when the server received the POST
}

/** GET /api/wanyrix/scan-runs envelope. */
export interface ServerScanRunsPayload {
  schema: string
  workspace: string
  count: number
  note: string
  runs: ServerScanRun[]
}

/**
 * The durable server-side scan-run log for the ACTIVE workspace — SQLite
 * rows synced from real browser sessions (POST /api/wanyrix/scan-runs).
 * The server NEVER fabricates runs (Gate 21): empty `runs` means nothing
 * has been synced, not a failure.
 */
export function useServerScanRuns() {
  const ws = useActiveWorkspace()
  return useQuery<ServerScanRunsPayload>({
    queryKey: ['scan-runs-server', ws],
    queryFn: () => getJson(`/api/wanyrix/scan-runs?ws=${encodeURIComponent(ws)}`),
  })
}

/** Joined per-run sync state — combines session POSTs with the server log. */
export type RunSyncState = 'synced' | 'pending' | 'failed' | 'unsynced'

export interface ScanRunSync {
  /** local runs for the active workspace (newest first) */
  runs: ScanRunRecord[]
  /** joined sync state of one local run id */
  stateOf: (id: string) => RunSyncState
  /** how many local runs are confirmed on the server */
  syncedCount: number
  /** durable server log query (rows, count, loading/error state) */
  server: ReturnType<typeof useServerScanRuns>
}

/**
 * Joins the browser-local run log with the durable server log into per-run
 * sync states:
 *   - `synced`   — this session's POST confirmed it, OR the server log lists it
 *   - `pending`  — this session's POST is in flight
 *   - `failed`   — this session's POST failed (run stays safe locally)
 *   - `unsynced` — recorded before sync existed / POST never succeeded; NOT
 *                  derivable as failure — offer the backfill action instead
 */
export function useScanRunSync(): ScanRunSync {
  const ws = useActiveWorkspace()
  // Select the stable map reference and derive the per-ws list in useMemo —
  // selecting `runs[ws] ?? []` directly would allocate a new array per
  // snapshot call (missing key) and trip React's getSnapshot cache check.
  const runsMap = useScanStore((s) => s.runs)
  const runs = useMemo(() => runsMap[ws] ?? [], [runsMap, ws])
  const sessionStatus = useSyncStatusStore((s) => s.status)
  const server = useServerScanRuns()

  const serverIds = useMemo(
    () => new Set(server.data?.runs.map((r) => r.id) ?? []),
    [server.data],
  )

  const stateOf = useCallback(
    (id: string): RunSyncState => {
      const s = sessionStatus[id]
      if (s === 'pending') return 'pending'
      if (s === 'failed') return 'failed'
      if (s === 'synced' || serverIds.has(id)) return 'synced'
      return 'unsynced'
    },
    [sessionStatus, serverIds],
  )

  const syncedCount = useMemo(
    () => runs.filter((r) => stateOf(r.id) === 'synced').length,
    [runs, stateOf],
  )

  return { runs, stateOf, syncedCount, server }
}

export interface SyncRunsResponse {
  schema: string
  run: ServerScanRun
}

/** POST one local run to the durable server log (idempotent upsert by id). */
async function postScanRun(run: ScanRunRecord): Promise<SyncRunsResponse> {
  const res = await fetch('/api/wanyrix/scan-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(run),
  })
  if (!res.ok) throw new Error(`scan-runs sync → ${res.status}`)
  return res.json() as Promise<SyncRunsResponse>
}

export interface BackfillResult {
  synced: number
  failed: number
}

/**
 * Backfills every `unsynced` local run into the durable server log — the
 * manual recovery path for runs recorded before sync existed or whose
 * fire-and-forget POST failed. Only runs still missing from the server log
 * are POSTed (idempotent upsert makes retries safe). Session status is
 * updated per run; the server-log query is invalidated once at the end.
 */
export function useBackfillScanRuns(): UseMutationResult<BackfillResult, Error, void> {
  const ws = useActiveWorkspace()
  const queryClient = useQueryClient()
  return useMutation<BackfillResult, Error, void>({
    mutationFn: async () => {
      const runs = useScanStore.getState().runs[ws] ?? []
      const serverIds = new Set(
        (queryClient.getQueryData<ServerScanRunsPayload>(['scan-runs-server', ws])?.runs ?? []).map(
          (r) => r.id,
        ),
      )
      const sync = useSyncStatusStore.getState()
      let synced = 0
      let failed = 0
      for (const run of runs) {
        const s = sync.status[run.id]
        if (s === 'synced' || s === 'pending' || serverIds.has(run.id)) continue
        sync.markPending(run.id)
        try {
          await postScanRun(run)
          useSyncStatusStore.getState().markSynced(run.id)
          synced += 1
        } catch {
          useSyncStatusStore.getState().markFailed(run.id)
          failed += 1
        }
      }
      return { synced, failed }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scan-runs-server', ws] })
    },
  })
}

/* ------------------------------------------------------ scan-run recording */

/** Input of {@link useRecordScanRun} — run figures only, workspace folded in. */
export type RecordScanRunInput = Omit<ScanRunInput, 'workspaceId'>

/**
 * Records a completed doctor-scan run for the ACTIVE workspace into the
 * persisted scan-run log (Task 3-b: zustand persist, `wanyrix.scan-store`
 * key, capped at 50 runs, deterministic `run-<count>-<startedAt>` ids).
 *
 * SERVER SYNC (additive): after the local record lands, the run is also
 * fire-and-forget POSTed to `/api/wanyrix/scan-runs` (`wanyrix.scan-runs/v1`)
 * — the optional durable server log. This NEVER blocks or fails the UI: the
 * browser-local log stays the source of truth, and a sync failure is silent
 * (the run remains recorded locally). The server persists exactly what was
 * measured and sent — it never fabricates runs (Gate 21). The POST outcome is
 * mirrored into the ephemeral sync-status store (`sync-status-store.ts`) so
 * the History view can badge runs synced/pending/failed; cross-session truth
 * is always re-derived from the server log itself (`useServerScanRuns`).
 *
 * STORE-API-ONLY contract: this hook deliberately does no UI wiring — the
 * "Run scan" action lives in the app shell / doctor view (component-layer
 * ownership). Call it once at scan completion with the measured figures;
 * `trigger` defaults to `'manual'` (pass `'topbar'` / `'palette'` where the
 * origin is known). Returns the created {@link ScanRunRecord} so callers can
 * surface its id/duration in a toast or status line.
 */
export function useRecordScanRun(): (input: RecordScanRunInput) => ScanRunRecord {
  const recordScanRun = useScanStore((s) => s.recordScanRun)
  const activeWs = useWorkspaceStore((s) => s.active)
  const queryClient = useQueryClient()
  return useCallback(
    (input) => {
      const record = recordScanRun({ trigger: 'manual', ...input, workspaceId: activeWs })
      if (typeof window !== 'undefined') {
        useSyncStatusStore.getState().markPending(record.id)
        void postScanRun(record)
          .then(() => {
            useSyncStatusStore.getState().markSynced(record.id)
            void queryClient.invalidateQueries({ queryKey: ['scan-runs-server', activeWs] })
          })
          .catch(() => {
            useSyncStatusStore.getState().markFailed(record.id)
          })
      }
      return record
    },
    [recordScanRun, activeWs, queryClient],
  )
}

/* ------------------------------------------------- repositories (AUDIT-I3) */

/**
 * Health snapshot for EVERY registered workspace (not just the active one) —
 * powers the Repositories view. Uses the same /api/wanyrix/health route with
 * an explicit `ws` param per workspace, so no new network surface is created.
 */
export function useWorkspaceHealths(workspaces: WorkspaceSummary[]) {
  return useQueries({
    queries: workspaces.map((w) => ({
      queryKey: ['health', w.id],
      queryFn: () => getJson<HealthPayload>(`/api/wanyrix/health?ws=${encodeURIComponent(w.id)}`),
      staleTime: 60_000,
    })),
  })
}
