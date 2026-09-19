'use client'

import { useCallback } from 'react'
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
 * measured and sent — it never fabricates runs (Gate 21).
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
  return useCallback(
    (input) => {
      const record = recordScanRun({ trigger: 'manual', ...input, workspaceId: activeWs })
      if (typeof window !== 'undefined') {
        void fetch('/api/wanyrix/scan-runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(record),
        }).catch(() => {}) // fire-and-forget: local log is the source of truth
      }
      return record
    },
    [recordScanRun, activeWs],
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
