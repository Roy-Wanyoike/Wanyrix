'use client'

import { useMemo } from 'react'
import {
  ArrowRight,
  CircleCheck,
  Database,
  GitBranch,
  RefreshCw,
  ScanSearch,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useWorkspaces, useWorkspaceHealths } from '@/lib/wanyrix/hooks'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import type { WorkspaceSummary } from '@/lib/wanyrix/types'
import { CachedDataBanner, DataErrorPanel, ViewSkeleton, WorkspaceProvenanceBadge } from '../shared'
import type { ViewProps } from '../view-types'

const WS_ACCENT: Record<WorkspaceSummary['accent'], string> = {
  primary: 'bg-primary',
  emerald: 'bg-emerald-400',
  zinc: 'bg-zinc-400',
}

/** Relative-time formatter for lastScan ISO stamps (client-side, honest). */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Repositories (AUDIT-I3 required surface) — the workspace registry as a
 * first-class view: every registered workspace with health, snapshot/scan
 * recency and finding counts, straight from the existing
 * /api/wanyrix/workspaces + /api/wanyrix/health routes.
 * Read-only on purpose: workspaces are registered via the wanyrix engine/CLI,
 * not mutated from the dashboard (audit security note).
 */
export default function RepositoriesView({ onNavigate }: ViewProps) {
  const workspacesQuery = useWorkspaces()
  const workspaces = useMemo(() => workspacesQuery.data?.workspaces ?? [], [workspacesQuery.data])
  const healths = useWorkspaceHealths(workspaces)

  /* issue #99: a mid-session failure must never degrade into a silent cache —
     when the registry/health payloads still render from the last successful
     fetch, say so with the degraded banner + retry. */
  const workspacesError = workspacesQuery.isError
    ? (workspacesQuery.error as Error | null)?.message ?? 'registry refresh failed'
    : undefined
  const healthsError = healths.some((h) => h.isError && h.data !== undefined)
    ? 'workspace health refresh failed'
    : undefined

  const activeWs = useWorkspaceStore((s) => s.active)
  const setActiveWs = useWorkspaceStore((s) => s.setActive)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  if (workspacesQuery.isLoading) return <ViewSkeleton kpiCount={2} />
  if ((workspacesQuery.isError && !workspacesQuery.data) || workspaces.length === 0)
    return (
      <DataErrorPanel
        title="Workspace registry unavailable"
        message={workspacesQuery.isError ? (workspacesQuery.error as Error).message : 'empty registry'}
        onRetry={() => workspacesQuery.refetch()}
      />
    )

  const retryAll = () => {
    void workspacesQuery.refetch()
    void queryClient.invalidateQueries({ queryKey: ['health'] })
  }

  const switchTo = (id: string) => {
    if (id === activeWs) return
    setActiveWs(id)
    queryClient.invalidateQueries()
    const ws = workspaces.find((w) => w.id === id)
    toast({
      title: `Workspace → ${ws?.name ?? id}`,
      description: `${ws?.crates ?? '?'} crates · ${ws?.edges ?? '?'} edges · re-querying scoped surfaces`,
    })
  }

  return (
    <div className="space-y-5">
      {/* issue #99: cached payloads after a mid-session failure are labeled,
          never presented silently as live data */}
      {(workspacesError || healthsError) && (
        <CachedDataBanner
          message={workspacesError ?? healthsError}
          onRetry={retryAll}
          retrying={workspacesQuery.isRefetching}
        />
      )}

      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary/90">Workspace Registry</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Repositories</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {workspaces.length} registered workspace{workspaces.length === 1 ? '' : 's'} · health, scan recency
            and finding counts from the local engine registry
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 font-mono text-[10px] text-muted-foreground">
            <GitBranch className="size-3" />
            read-only registry
          </Badge>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => workspacesQuery.refetch()}>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* registry table */}
      <section className="overflow-hidden rounded-xl border border-border/80 bg-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Registered workspaces</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              served by <span className="font-mono">/api/wanyrix/workspaces</span> · health via{' '}
              <span className="font-mono">/api/wanyrix/health?ws=…</span>
            </p>
          </div>
        </header>

        {/* desktop table */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Crates</TableHead>
                <TableHead className="text-right">Edges</TableHead>
                <TableHead className="text-right">Findings</TableHead>
                <TableHead className="text-right">Cache hit</TableHead>
                <TableHead>Toolchain</TableHead>
                <TableHead className="text-right">Last scan</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((w, i) => {
                const health = healths[i]?.data
                return (
                  <TableRow key={w.id} className={w.id === activeWs ? 'bg-primary/5' : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={`size-2 shrink-0 rounded-full ${WS_ACCENT[w.accent]}`} aria-hidden />
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[13px] font-medium">{w.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{w.description}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {/* QA-5-B-4: fixture rows are demo data (amber DEMO chip),
                          never the pulsing LIVE label — provenance from fixtureOnly. */}
                      <WorkspaceProvenanceBadge fixtureOnly={w.fixtureOnly} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{w.crates}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{w.edges}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{w.findings}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {health ? `${health.cacheHitRate}%` : <span className="text-muted-foreground/90">…</span>}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{w.toolchain}</TableCell>
                    <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
                      {timeAgo(w.lastScan)}
                    </TableCell>
                    <TableCell className="text-right">
                      {w.id === activeWs ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase text-emerald-300">
                          <CircleCheck className="size-3.5" aria-hidden />
                          active
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => switchTo(w.id)}>
                          Set active
                          <ArrowRight className="size-3" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {/* mobile cards */}
        <ul className="divide-y divide-border/60 md:hidden">
          {workspaces.map((w, i) => {
            const health = healths[i]?.data
            return (
              <li key={w.id} className="space-y-2.5 p-4">
                <div className="flex items-center gap-2">
                  <span className={`size-2 shrink-0 rounded-full ${WS_ACCENT[w.accent]}`} aria-hidden />
                  <p className="truncate font-mono text-[13px] font-medium">{w.name}</p>
                  {w.id === activeWs ? (
                    <Badge variant="outline" className="ml-auto gap-1 border-emerald-500/30 text-emerald-300">
                      <CircleCheck className="size-3" /> active
                    </Badge>
                  ) : (
                    <Button size="sm" variant="outline" className="ml-auto h-8 gap-1 text-[11px]" onClick={() => switchTo(w.id)}>
                      Set active
                    </Button>
                  )}
                </div>
                <p className="text-[11.5px] text-muted-foreground">{w.description}</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <dt>crates</dt>
                    <dd className="tabular-nums text-foreground/85">{w.crates}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>edges</dt>
                    <dd className="tabular-nums text-foreground/85">{w.edges}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>findings</dt>
                    <dd className="tabular-nums text-foreground/85">{w.findings}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>cache hit</dt>
                    <dd className="tabular-nums text-foreground/85">{health ? `${health.cacheHitRate}%` : '…'}</dd>
                  </div>
                  <div className="col-span-2 flex justify-between gap-2">
                    <dt>last scan</dt>
                    <dd>{timeAgo(w.lastScan)}</dd>
                  </div>
                </dl>
                <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/90">
                  <WorkspaceProvenanceBadge fixtureOnly={w.fixtureOnly} />
                  <span aria-hidden>·</span> {w.toolchain}
                </p>
              </li>
            )
          })}
        </ul>
      </section>

      {/* honest scope note */}
      <div className="flex flex-wrap items-start gap-2.5 rounded-lg border border-border/70 bg-muted/10 p-3">
        <Database className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          The registry is served by the local engine. New repositories are registered through the{' '}
          <span className="font-mono text-foreground/85">wanyrix</span> CLI / engine config — this dashboard reads
          the registry and switches the active workspace, it never mutates it (no writes beyond fixtures in this
          environment). Finding counts are from the last doctor scan per workspace.
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto gap-1 text-xs text-primary hover:text-primary"
          onClick={() => onNavigate?.('doctor')}
        >
          <ScanSearch className="size-3.5" />
          Run doctor on active workspace
        </Button>
      </div>
    </div>
  )
}
