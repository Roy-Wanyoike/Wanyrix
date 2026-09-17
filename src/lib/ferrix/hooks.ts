'use client'

import { useMutation, useQuery, UseMutationResult } from '@tanstack/react-query'
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
} from './types'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json() as Promise<T>
}

export function useHealth() {
  return useQuery<HealthPayload>({ queryKey: ['health'], queryFn: () => getJson('/api/ferrix/health') })
}

export function useDoctor() {
  return useQuery<DoctorReport>({ queryKey: ['doctor'], queryFn: () => getJson('/api/ferrix/doctor') })
}

export function useGraph() {
  return useQuery<GraphPayload>({ queryKey: ['graph'], queryFn: () => getJson('/api/ferrix/graph') })
}

export function useDiagnostics() {
  return useQuery<DiagnosticsPayload>({
    queryKey: ['diagnostics'],
    queryFn: () => getJson('/api/ferrix/diagnostics'),
  })
}

export function useImpact(type: 'add-dep' | 'edit-file' | 'split-crate', target: string) {
  return useQuery<ImpactPayload>({
    queryKey: ['impact', type, target],
    queryFn: () => getJson(`/api/ferrix/impact?type=${encodeURIComponent(type)}&target=${encodeURIComponent(target)}`),
    enabled: type === 'split-crate' || target.length > 0,
  })
}

export function useExperiments() {
  return useQuery<ExperimentsPayload>({
    queryKey: ['experiments'],
    queryFn: () => getJson('/api/ferrix/experiments'),
  })
}

export function useGates() {
  return useQuery<GatesPayload>({ queryKey: ['gates'], queryFn: () => getJson('/api/ferrix/gates') })
}

export function useIssues() {
  return useQuery<IssuesPayload>({ queryKey: ['issues'], queryFn: () => getJson('/api/ferrix/issues') })
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
