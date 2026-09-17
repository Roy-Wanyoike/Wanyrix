'use client'

import { useMutation, useQuery, useQueryClient, UseMutationResult } from '@tanstack/react-query'
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
  WorkspacesPayload,
} from './types'
import { useWorkspaceStore } from './workspace-store'

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
    queryFn: () => getJson('/api/ferrix/workspaces'),
    staleTime: Infinity,
  })
}

export function useHealth() {
  const ws = useActiveWorkspace()
  return useQuery<HealthPayload>({
    queryKey: ['health', ws],
    queryFn: () => getJson(`/api/ferrix/health?ws=${encodeURIComponent(ws)}`),
  })
}

export function useDoctor() {
  const ws = useActiveWorkspace()
  return useQuery<DoctorReport>({
    queryKey: ['doctor', ws],
    queryFn: () => getJson(`/api/ferrix/doctor?ws=${encodeURIComponent(ws)}`),
  })
}

export function useGraph() {
  const ws = useActiveWorkspace()
  return useQuery<GraphPayload>({
    queryKey: ['graph', ws],
    queryFn: () => getJson(`/api/ferrix/graph?ws=${encodeURIComponent(ws)}`),
  })
}

export function useDiagnostics() {
  const ws = useActiveWorkspace()
  return useQuery<DiagnosticsPayload>({
    queryKey: ['diagnostics', ws],
    queryFn: () => getJson(`/api/ferrix/diagnostics?ws=${encodeURIComponent(ws)}`),
  })
}

export function useImpact(type: 'add-dep' | 'edit-file' | 'split-crate' | 'upgrade-dep', target: string) {
  const ws = useActiveWorkspace()
  return useQuery<ImpactPayload>({
    queryKey: ['impact', type, target, ws],
    queryFn: () =>
      getJson(
        `/api/ferrix/impact?type=${encodeURIComponent(type)}&target=${encodeURIComponent(target)}&ws=${encodeURIComponent(ws)}`,
      ),
    enabled: type === 'split-crate' || target.length > 0,
  })
}

export function useExperiments() {
  const ws = useActiveWorkspace()
  return useQuery<ExperimentsPayload>({
    queryKey: ['experiments', ws],
    queryFn: () => getJson(`/api/ferrix/experiments?ws=${encodeURIComponent(ws)}`),
  })
}

export function usePRAnalysis() {
  const ws = useActiveWorkspace()
  return useQuery<PRAnalysis>({
    queryKey: ['pr', ws],
    queryFn: () => getJson(`/api/ferrix/pr?ws=${encodeURIComponent(ws)}`),
    staleTime: Infinity,
  })
}

export function useGates() {
  return useQuery<GatesPayload>({ queryKey: ['gates'], queryFn: () => getJson('/api/ferrix/gates') })
}

export function useIssues() {
  return useQuery<IssuesPayload>({ queryKey: ['issues'], queryFn: () => getJson('/api/ferrix/issues') })
}

export function useStorage() {
  return useQuery<StoragePayload>({
    queryKey: ['storage'],
    queryFn: () => getJson('/api/ferrix/storage'),
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
      const res = await fetch('/api/ferrix/storage/reclaim', { method: 'POST' })
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
      const res = await fetch('/api/ferrix/storage/rebuild', { method: 'POST' })
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
      const res = await fetch('/api/ferrix/explain', {
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
  filename: string
  markdown: string
  bytes: number
}

/**
 * Exports the server-assembled Markdown workspace report and triggers a
 * browser download. Mutation state drives the topbar button spinner.
 */
export function useReportExport(): UseMutationResult<ReportBundle, Error, void> {
  const ws = useActiveWorkspace()
  return useMutation<ReportBundle, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/ferrix/report?ws=${encodeURIComponent(ws)}`)
      if (!res.ok) throw new Error(`report → ${res.status}`)
      const bundle = (await res.json()) as ReportBundle
      const { downloadText } = await import('./patch')
      downloadText(bundle.filename, bundle.markdown)
      return bundle
    },
  })
}
