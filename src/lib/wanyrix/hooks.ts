'use client'

import { useCallback, useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient, UseMutationResult } from '@tanstack/react-query'
import type {
  DiagnosticsPayload,
  DoctorReport,
  EngineGitReport,
  EngineImpactReport,
  EngineWhatChangedReport,
  ExplainRequest,
  ExplainResponse,
  GatesPayload,
  GraphPayload,
  HealthPayload,
  ImpactPayload,
  IssuesPayload,
  ExperimentsPayload,
  PRAnalysis,
  RegisteredWorkspaceSummary,
  StoragePayload,
  WorkspaceSummary,
  WorkspacesPayload,
} from './types'
import { useWorkspaceStore } from './workspace-store'
import {
  useScanStore,
  type ScanHistoryEntry,
  type ScanRunInput,
  type ScanRunRecord,
  type ScanTrigger,
} from './scan-store'
import { capFindingIds } from './finding-diff'
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

/* -------------------------------------------- workspace registration bridge */

/** Envelope of the POST /api/wanyrix/workspaces connect flow (Task 2-b). */
export interface RegisterWorkspaceResponse {
  registered: true
  workspace: RegisteredWorkspaceSummary
  /** measured by the real engine during registration — never invented */
  verdict: {
    crates: number
    edges: number
    critical: number
    warning: number
    info: number
    findings: number
    toolchain: string
    engineVersion: string
  }
}

/**
 * The user-registered LOCAL projects (the "Connect a project" bridge).
 * Reads the shared /api/wanyrix/workspaces payload and selects `.registered`
 * — empty array = nothing connected yet (the server never fabricates rows,
 * Gate 21). Invalidated together with the demo registry because both live on
 * the same endpoint.
 */
export function useRegisteredWorkspaces() {
  return useQuery<RegisteredWorkspaceSummary[]>({
    queryKey: ['workspaces', 'registered'],
    queryFn: async () => {
      const payload = await getJson<WorkspacesPayload>('/api/wanyrix/workspaces')
      return payload.registered ?? []
    },
    staleTime: Infinity,
  })
}

/**
 * Connects a local Rust project: POST { path } → the route runs the REAL
 * engine (doctor + graph) against the path and upserts a measured row.
 * Failures throw {@link EngineExecError} carrying the route's named reason
 * (400 validation / 404 not a Rust project / 502 engine failure / 503 binary
 * missing + build hint). Invalidates every ['workspaces'] query on success.
 */
export function useRegisterWorkspace(): UseMutationResult<
  RegisterWorkspaceResponse,
  EngineExecError,
  string
> {
  const queryClient = useQueryClient()
  return useMutation<RegisterWorkspaceResponse, EngineExecError, string>({
    mutationFn: async (path: string) => {
      const res = await fetch('/api/wanyrix/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const body: unknown = await res.json().catch(() => null)
      const rec = (body ?? {}) as Record<string, unknown>
      if (!res.ok || typeof rec.error === 'string') {
        throw new EngineExecError(
          typeof rec.error === 'string' ? rec.error : `connect → ${res.status}`,
          res.status,
          typeof rec.detail === 'string' ? rec.detail : undefined,
          typeof rec.hint === 'string' ? rec.hint : undefined,
        )
      }
      return body as RegisterWorkspaceResponse
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

/** Envelope of DELETE /api/wanyrix/workspaces?id=… (Task 2-b). */
export interface UnregisterWorkspaceResponse {
  unregistered: true
  id: string
}

/**
 * Removes one registered local project by id. Invalidates every
 * ['workspaces'] query on success (registry + registered list).
 */
export function useUnregisterWorkspace(): UseMutationResult<
  UnregisterWorkspaceResponse,
  EngineExecError,
  string
> {
  const queryClient = useQueryClient()
  return useMutation<UnregisterWorkspaceResponse, EngineExecError, string>({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/wanyrix/workspaces?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const body: unknown = await res.json().catch(() => null)
      const rec = (body ?? {}) as Record<string, unknown>
      if (!res.ok || typeof rec.error === 'string') {
        throw new EngineExecError(
          typeof rec.error === 'string' ? rec.error : `unregister → ${res.status}`,
          res.status,
          typeof rec.detail === 'string' ? rec.detail : undefined,
          typeof rec.hint === 'string' ? rec.hint : undefined,
        )
      }
      return body as UnregisterWorkspaceResponse
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

/**
 * Re-scans a REGISTERED local project through the REAL engine
 * (`GET /api/wanyrix/engine/doctor?workspace=<id>` — only DB-stored paths
 * are ever scanned). On success the route refreshed the stored measured
 * counts; invalidating ['workspaces'] pulls the fresh row into every
 * consumer. Failures keep the honest per-status contract (503 not built /
 * 502 failed / 504 timeout / 404 unknown id) via {@link EngineExecError}.
 */
export function useScanRegisteredWorkspace(): UseMutationResult<
  EngineExecPayload,
  EngineExecError,
  RegisteredWorkspaceSummary
> {
  const queryClient = useQueryClient()
  return useMutation<EngineExecPayload, EngineExecError, RegisteredWorkspaceSummary>({
    mutationFn: async (ws) => {
      const res = await fetch(
        `/api/wanyrix/engine/doctor?workspace=${encodeURIComponent(ws.id)}`,
      )
      return parseEngineExecResponse<EngineExecPayload>(res)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

export function useHealth() {
  const ws = useActiveWorkspace()
  return useQuery<HealthPayload>({
    queryKey: ['health', ws],
    queryFn: () => getJson(`/api/wanyrix/health?ws=${encodeURIComponent(ws)}`),
  })
}

/**
 * Fetches ONE fresh doctor report for `ws` — the shared queryFn behind
 * {@link useDoctor}, exposed so the app shell can run the topbar / ⌘K scan
 * headlessly (issue #99): same endpoint, same envelope, no duplicated route
 * knowledge in the component layer.
 */
export function fetchDoctorReport(ws: string): Promise<DoctorReport> {
  return getJson<DoctorReport>(`/api/wanyrix/doctor?ws=${encodeURIComponent(ws)}`)
}

export function useDoctor() {
  const ws = useActiveWorkspace()
  return useQuery<DoctorReport>({
    queryKey: ['doctor', ws],
    queryFn: () => fetchDoctorReport(ws),
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
  /** R7 findings fingerprint — present only on runs POSTed with one. */
  findingIds?: string[]
  findingIdsTruncated?: boolean
  /** Issue #128 — `true` on runs whose figures replayed the stored report. */
  replay?: boolean
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

/* ------------------------------------------------------- real engine exec */

/**
 * Minimal `wanyrix.engine-exec/v1` envelope MINUS the surface-specific
 * `report` — the shared base for every real-exec payload (doctor, build and
 * the issue #69 change-intelligence surfaces). `report` is always the
 * engine's verbatim stdout; only its TYPE differs per surface.
 */
export interface EngineSurfaceEnvelope {
  schema: string
  executedAt: string
  durationMs: number
  binary: { version: string; profile: 'debug' | 'release' }
  scanTarget: string
  /** present only when the exec targeted a REGISTERED local project (`?workspace=<id>`) */
  workspaceId?: string
  note: string
}

/** Envelope of `GET /api/wanyrix/engine/doctor` (`wanyrix.engine-exec/v1`). */
export interface EngineExecPayload extends EngineSurfaceEnvelope {
  /** verbatim `wanyrix.doctor/v1` stdout of the real binary (loosely typed) */
  report: {
    schema?: string
    workspace?: string
    /** R8: engine findings carry their own stable ids (`FER-ENG-*`). */
    findings?: { id?: string; severity?: string; [k: string]: unknown }[]
    crates?: unknown[]
    [k: string]: unknown
  }
}

/**
 * On-demand execution of the REAL `wanyrix` binary on the server host
 * (`wanyrix doctor --path engine --json`) — the one route that executes
 * instead of mirroring. Mutation (not query) because each click is a fresh
 * process spawn whose result is a point-in-time measurement; errors carry
 * the honest per-status contract (503 not built / 502 failed / 504 timeout).
 */
export function useEngineDoctor(): UseMutationResult<EngineExecPayload, EngineExecError, void> {
  return useMutation<EngineExecPayload, EngineExecError, void>({
    mutationFn: async () => {
      const res = await fetch('/api/wanyrix/engine/doctor')
      return parseEngineExecResponse(res)
    },
  })
}

/**
 * R8: on-demand INSTRUMENTED BUILD through the real binary
 * (`wanyrix build --path engine --json` → `wanyrix.build/v1`): measured wall
 * clock, measured fresh/cache-hit rate (read from cargo's artifact flags),
 * per-artifact stream activity and redacted diagnostics. This is the first
 * surface where `cacheHitRate` is MEASURED rather than labeled not-measured.
 * Longer timeout than the doctor exec (a cold build may recompile crates).
 */
export function useEngineBuild(): UseMutationResult<EngineBuildPayload, EngineExecError, void> {
  return useMutation<EngineBuildPayload, EngineExecError, void>({
    mutationFn: async () => {
      const res = await fetch('/api/wanyrix/engine/build')
      return parseEngineExecResponse(res)
    },
  })
}

/** Shared engine-route response handling — verbatim envelope or honest error. */
function parseEngineExecResponse<P extends EngineSurfaceEnvelope>(res: Response): Promise<P> {
  return (async () => {
    const body: unknown = await res.json().catch(() => null)
    const rec = (body ?? {}) as Record<string, unknown>
    if (!res.ok || typeof rec.error === 'string') {
      throw new EngineExecError(
        typeof rec.error === 'string' ? rec.error : `engine exec → ${res.status}`,
        res.status,
        typeof rec.detail === 'string' ? rec.detail : undefined,
        typeof rec.hint === 'string' ? rec.hint : undefined,
      )
    }
    return body as P
  })()
}

/** Envelope of `GET /api/wanyrix/engine/build` (`wanyrix.engine-build/v1`). */
export interface EngineBuildPayload {
  schema: string
  executedAt: string
  /** wall clock of the whole wanyrix build exec (route-measured) */
  durationMs: number
  binary: { version: string; profile: 'debug' | 'release' }
  scanTarget: string
  note: string
  /** verbatim `wanyrix.build/v1` stdout of the real binary (loosely typed) */
  report: {
    schema?: string
    workspace?: string
    command?: string
    buildSuccess?: boolean
    exitCode?: number
    cargoStderrTail?: string
    wallClockMs?: number
    durationStatus?: string
    summary?: {
      artifactsTotal?: number
      artifactsFresh?: number
      artifactsRebuilt?: number
      cacheHitRate?: number
      cacheHitRateStatus?: string
      warnings?: number
      errors?: number
      ice?: number
      notes?: number
      malformedLines?: number
      unknownReasons?: number
      lifecycleEvents?: number
      [k: string]: unknown
    }
    artifacts?: {
      package?: string
      targetKinds?: string[]
      fresh?: boolean
      arrivalDeltaMs?: number
      [k: string]: unknown
    }[]
    byCode?: { code?: string; count?: number; [k: string]: unknown }[]
    redaction?: {
      applied?: boolean
      policy?: string
      renderedDropped?: number
      secretsScrubbed?: number
      [k: string]: unknown
    }
    notes?: string[]
    [k: string]: unknown
  }
}

/* ------------------------------------------- engine change intelligence -- */

/**
 * Issue #69 — the three engine v0.8.0 change-intelligence surfaces served by
 * the real binary through `wanyrix.engine-exec/v1` wrappers:
 *   GET /api/wanyrix/git                    → `wanyrix.git/v1`
 *   GET /api/wanyrix/engine/impact?crate=…  → `wanyrix.impact/v1`
 *   GET /api/wanyrix/what-changed           → `wanyrix.what-changed/v1`
 * Queries (not mutations): the panel renders live state on mount; each refetch
 * is a fresh process spawn, so results are point-in-time measurements and
 * named errors (EngineExecError) are terminal — no silent retries of a
 * process that already reported honestly.
 */

/** Envelope of `GET /api/wanyrix/git` — `report` is the verbatim `wanyrix.git/v1`. */
export interface EngineGitPayload extends EngineSurfaceEnvelope {
  surface: 'git'
  report: EngineGitReport
}

/**
 * The measured git state of one real exec target — dogfood engine dir by
 * default, or a REGISTERED local project via its `ws-local-…` id (the same
 * resolution contract as {@link useScanRegisteredWorkspace}).
 */
export function useEngineGit(target?: string) {
  return useQuery<EngineGitPayload, EngineExecError>({
    queryKey: ['engine-git', target ?? ''],
    queryFn: async () => {
      const qs = target ? `?workspace=${encodeURIComponent(target)}` : ''
      return parseEngineExecResponse<EngineGitPayload>(
        await fetch(`/api/wanyrix/git${qs}`),
      )
    },
    staleTime: 15_000,
    retry: false,
  })
}

/** Envelope of `GET /api/wanyrix/engine/impact` — `report` is the verbatim `wanyrix.impact/v1`. */
export interface EngineImpactPayload extends EngineSurfaceEnvelope {
  surface: 'impact'
  report: EngineImpactReport
}

/**
 * Measured rebuild blast radius for one crate of the exec target. Disabled
 * until a crate name is committed (the panel auto-commits the engine's own
 * `workspace` name / first changed crate, or the user types one).
 */
export function useEngineImpact(crate: string, target?: string) {
  return useQuery<EngineImpactPayload, EngineExecError>({
    queryKey: ['engine-impact', crate, target ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams({ crate })
      if (target) params.set('workspace', target)
      return parseEngineExecResponse<EngineImpactPayload>(
        await fetch(`/api/wanyrix/engine/impact?${params.toString()}`),
      )
    },
    enabled: crate.trim().length > 0,
    staleTime: 15_000,
    retry: false,
  })
}

/** Envelope of `GET /api/wanyrix/what-changed` — `report` is the verbatim `wanyrix.what-changed/v1`. */
export interface EngineWhatChangedPayload extends EngineSurfaceEnvelope {
  surface: 'what-changed'
  report: EngineWhatChangedReport
}

/**
 * Findings delta vs the stored baseline of the exec target's own
 * `.wanyrix/store.db`. A missing store surfaces as a 503 EngineExecError
 * (verbatim engine stderr) — an initialized but baseline-less store is a
 * VALID envelope with `against` omitted + `baselineNote`, rendered as-is.
 */
export function useEngineWhatChanged(target?: string) {
  return useQuery<EngineWhatChangedPayload, EngineExecError>({
    queryKey: ['engine-what-changed', target ?? ''],
    queryFn: async () => {
      const qs = target ? `?workspace=${encodeURIComponent(target)}` : ''
      return parseEngineExecResponse<EngineWhatChangedPayload>(
        await fetch(`/api/wanyrix/what-changed${qs}`),
      )
    },
    staleTime: 15_000,
    retry: false,
  })
}

/** Typed engine-exec failure — status + optional detail/hint from the route. */
export class EngineExecError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'EngineExecError'
  }
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

/**
 * Issue #128 — pure record construction for ONE completed doctor run.
 *
 * Every run recorded through this builder REPLAYS the stored doctor report
 * (`GET /api/wanyrix/doctor` serves the stored fixture payload; the engine
 * binary is NOT invoked by the doctor view / topbar / ⌘K flows — the real
 * binary lives behind the "Real engine binary" panel, which records via
 * {@link useRecordScanRun} with trigger `'engine-exec'` and never sets the
 * replay flag). Both produced records therefore carry `replay: true` so the
 * History surfaces can badge the replay honestly at the point of storage,
 * not only in a distant footnote.
 *
 * Pure (no React, no store, clock injected) so the flag plumbing is pinned
 * by unit tests (tests/unit/doctor-replay.test.ts).
 */
export function buildDoctorRunRecords(input: {
  report: DoctorReport
  trigger: ScanTrigger
  startedAt: number
  durationMs: number
  /** epoch ms for id/at stamping (inject the clock — determinism in tests) */
  now: number
  workspaceId: string
}): { entry: ScanHistoryEntry; run: ScanRunInput } {
  const { report, trigger, startedAt, durationMs, now, workspaceId } = input
  const fingerprint = capFindingIds(report.findings.map((f) => f.id))
  const critical = report.findings.filter((f) => f.severity === 'critical').length
  const warning = report.findings.filter((f) => f.severity === 'warning').length
  const info = report.findings.filter((f) => f.severity === 'info').length
  return {
    entry: {
      id: `scan-${now}`,
      workspace: workspaceId,
      at: now,
      durationMs,
      findings: report.findings.length,
      critical,
      warning,
      info,
      buildTime: report.buildTime,
      estimatedFrom: report.estimatedRange[0],
      estimatedTo: report.estimatedRange[1],
      trigger,
      findingIds: fingerprint.ids,
      ...(fingerprint.truncated ? { findingIdsTruncated: true } : {}),
      // issue #128: this run replayed the stored report — mark it as such.
      replay: true,
    },
    run: {
      workspaceId,
      startedAt,
      finishedAt: now,
      durationMs,
      findingCount: report.findings.length,
      severityCounts: { critical, warning, info },
      trigger,
      findingIds: fingerprint.ids,
      findingIdsTruncated: fingerprint.truncated,
      // issue #128: replay marker rides along to the durable server log.
      replay: true,
    },
  }
}

/**
 * Records ONE completed doctor run end-to-end (issue #37 + Task 3-b): appends
 * the History entry AND the structured scan-run record (which fire-and-forget
 * POSTs to the durable server log). Shared by the doctor view (its own button
 * + auto-run) and the app shell (topbar / ⌘K headless runs, issue #99) so the
 * entry shape can never drift between the two recorders.
 *
 * Issue #128: every run through this recorder is a REPLAY of the stored
 * doctor report (no engine invocation) — {@link buildDoctorRunRecords}
 * stamps `replay: true` on both records.
 *
 * Callers must gate on `useScanStore.getState().claimRunRecording(tick)` so a
 * single scan event is recorded exactly once.
 */
export function useRecordDoctorRun(): (input: {
  report: DoctorReport
  trigger: ScanTrigger
  startedAt: number
  durationMs: number
}) => ScanRunRecord {
  const activeWs = useWorkspaceStore((s) => s.active)
  const addScanEntry = useScanStore((s) => s.addEntry)
  const recordScanRun = useRecordScanRun()
  return useCallback(
    ({ report, trigger, startedAt, durationMs }) => {
      const { entry, run } = buildDoctorRunRecords({
        report,
        trigger,
        startedAt,
        durationMs,
        now: Date.now(),
        workspaceId: activeWs,
      })
      addScanEntry(activeWs, entry)
      return recordScanRun(run)
    },
    [activeWs, addScanEntry, recordScanRun],
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
