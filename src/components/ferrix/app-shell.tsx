'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  Calculator,
  FileDiff,
  FlaskConical,
  GitPullRequest,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Microscope,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { FerrixLogo } from './logo'
import { CommandPalette } from './command-palette'
import { DiffQueueSheet } from './diff-queue-sheet'
import { StorageDialog } from './storage-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useWorkspaces } from '@/lib/ferrix/hooks'
import { useWorkspaceStore } from '@/lib/ferrix/workspace-store'
import { useScanStore } from '@/lib/ferrix/scan-store'
import { countPending, useDiffQueueStore } from '@/lib/ferrix/diff-store'
import type { ViewId, WorkspaceSummary } from '@/lib/ferrix/types'

const WS_ACCENT: Record<WorkspaceSummary['accent'], string> = {
  primary: 'bg-primary',
  emerald: 'bg-emerald-400',
  zinc: 'bg-zinc-400',
}

const NAV: {
  group: string
  items: { id: ViewId; label: string; icon: React.ReactNode; hint: string }[]
}[] = [
  {
    group: 'Intelligence',
    items: [
      { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="size-4" />, hint: 'Engineering health' },
      { id: 'doctor', label: 'Build Doctor', icon: <Stethoscope className="size-4" />, hint: 'ferrix doctor' },
      { id: 'graph', label: 'Engineering Graph', icon: <Network className="size-4" />, hint: 'Blast radius' },
      { id: 'diagnostics', label: 'Diagnostics', icon: <Microscope className="size-4" />, hint: 'Borrow · async' },
    ],
  },
  {
    group: 'Action',
    items: [
      { id: 'prs', label: 'PR Analysis', icon: <GitPullRequest className="size-4" />, hint: 'Regression guard' },
      { id: 'simulator', label: 'Impact Simulator', icon: <Calculator className="size-4" />, hint: 'Change cost' },
      { id: 'experiments', label: 'Experiments', icon: <FlaskConical className="size-4" />, hint: 'Verify improvements' },
    ],
  },
  {
    group: 'Governance',
    items: [
      { id: 'scorecard', label: 'Release Scorecard', icon: <ShieldCheck className="size-4" />, hint: '45 MVP gates' },
      { id: 'issues', label: 'Issues & PRs', icon: <ListChecks className="size-4" />, hint: 'Traceability' },
    ],
  },
]

const TITLES: Record<ViewId, { title: string; sub: string }> = {
  overview: { title: 'Engineering Health', sub: 'continuously analyzed' },
  doctor: { title: 'Build Doctor', sub: 'ferrix doctor · evidence-backed findings' },
  graph: { title: 'Engineering Graph', sub: 'dependency backbone · blast radius' },
  diagnostics: { title: 'Diagnostics', sub: 'borrow-checker explainer · async flow' },
  prs: { title: 'PR Analysis', sub: 'build regression guard' },
  simulator: { title: 'Impact Simulator', sub: 'what will this change cost?' },
  experiments: { title: 'Experiments', sub: 'baseline → candidate → verified' },
  scorecard: { title: 'Release Scorecard', sub: 'MVP acceptance gates · GO / NO-GO' },
  issues: { title: 'Issues & PRs', sub: 'every issue fixed by a PR' },
}

export function AppShell({
  activeView,
  onNavigate,
  children,
}: {
  activeView: ViewId
  onNavigate: (v: ViewId) => void
  children: React.ReactNode
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [clock, setClock] = useState<string>('--:--:-- local')
  const [uptime, setUptime] = useState(22320) // 6h 12m in seconds — engine process age
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)

  /* workspace registry + active selection (issue #34) */
  const workspacesQuery = useWorkspaces()
  const workspaces = workspacesQuery.data?.workspaces ?? []
  const activeWs = useWorkspaceStore((s) => s.active)
  const setActiveWs = useWorkspaceStore((s) => s.setActive)
  const activeSummary = workspaces.find((w) => w.id === activeWs)

  /* global scan event (issue #37) + reviewable-diff queue (issue #38) */
  const bumpScan = useScanStore((s) => s.bumpScan)
  const diffEntries = useDiffQueueStore((s) => s.entries)
  const pendingDiffs = countPending(diffEntries, activeWs)

  useEffect(() => {
    const update = () => {
      setClock(
        new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' local',
      )
      setUptime((u) => u + 1)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  const uptimeLabel = `${Math.floor(uptime / 3600)}h ${String(Math.floor((uptime % 3600) / 60)).padStart(2, '0')}m ${String(uptime % 60).padStart(2, '0')}s`

  const runScan = () => {
    queryClient.invalidateQueries()
    bumpScan('topbar') // doctor view reacts with a replay + history entry (issue #37)
    toast({
      title: 'Scan re-triggered',
      description: `Ferrix engine is re-collecting cargo + git telemetry for ${activeSummary?.name ?? 'the active workspace'}.`,
    })
  }

  const switchWorkspace = (id: string) => {
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
    <div className="flex min-h-screen bg-background bg-grid">
      {/* ---------------- sidebar ---------------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border/70 bg-sidebar lg:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <FerrixLogo size={30} />
          <div>
            <p className="text-sm font-bold tracking-tight">Ferrix</p>
            <p className="font-mono text-[10px] text-muted-foreground">engineering intelligence</p>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Ferrix views">
          {NAV.map((group) => (
            <div key={group.group}>
              <p className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                {group.group}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => onNavigate(item.id)}
                      aria-current={activeView === item.id ? 'page' : undefined}
                      className={cn(
                        'group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-all duration-150',
                        activeView === item.id
                          ? 'bg-primary/12 text-foreground ring-1 ring-primary/25'
                          : 'text-muted-foreground hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-foreground',
                      )}
                    >
                      {activeView === item.id && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                      )}
                      <span className={cn(activeView === item.id ? 'text-primary' : 'opacity-70')}>
                        {item.icon}
                      </span>
                      <span className="flex-1 font-medium">{item.label}</span>
                      {activeView === item.id && <span className="size-1.5 rounded-full bg-primary" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-border/70 px-4 py-3">
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            ferrix engine v0.4.2
            <br />
            local-first · AI optional
          </p>
        </div>
      </aside>

      {/* ---------------- main column ---------------- */}
      <div className="flex min-h-screen flex-1 flex-col lg:pl-60">
        {/* topbar */}
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <FerrixLogo size={24} />
              <span className="text-sm font-bold">Ferrix</span>
            </div>
            <div className="hidden min-w-0 lg:block">
              <h2 className="truncate text-sm font-semibold">{TITLES[activeView].title}</h2>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{TITLES[activeView].sub}</p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="relative hidden h-8 w-52 items-center gap-2 rounded-md border border-input bg-card pl-8 pr-2 text-left text-xs text-muted-foreground/80 transition-colors hover:border-primary/30 hover:text-foreground md:flex"
                aria-label="Open command palette (Ctrl+K)"
              >
                <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
                <span className="flex-1 truncate">Search crates, findings, PRs…</span>
                <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px] text-muted-foreground">
                  ⌘K
                </kbd>
              </button>

              <Select
                value={activeWs}
                onValueChange={switchWorkspace}
                disabled={workspaces.length === 0}
              >
                <SelectTrigger
                  className="h-8 w-[168px] gap-1.5 text-xs"
                  aria-label="Workspace"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${WS_ACCENT[activeSummary?.accent ?? 'primary'] ?? 'bg-primary'}`}
                      aria-hidden
                    />
                    <SelectValue>{activeSummary?.name ?? 'loading…'}</SelectValue>
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id} className="text-xs">
                      <span className="flex items-center gap-2">
                        <span className={`size-1.5 rounded-full ${WS_ACCENT[w.accent]}`} aria-hidden />
                        {w.name}
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                          {w.crates} crates
                        </span>
                        {w.status === 'live' ? (
                          <span className="ml-auto flex items-center gap-1 font-mono text-[9px] uppercase text-emerald-300">
                            <span className="size-1 animate-pulse rounded-full bg-emerald-400" aria-hidden />
                            live
                          </span>
                        ) : (
                          <span className="ml-auto font-mono text-[9px] uppercase text-muted-foreground">
                            archived
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={runScan}>
                <RefreshCw className="size-3.5" />
                <span className="hidden sm:inline">Run scan</span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                className={cn('relative h-8 gap-1.5 text-xs', pendingDiffs > 0 && 'border-primary/40 text-foreground')}
                onClick={() => setDiffOpen(true)}
                aria-label={`Pending diffs — ${pendingDiffs} awaiting review`}
              >
                <FileDiff className="size-3.5" />
                <span className="hidden sm:inline">Pending diffs</span>
                {pendingDiffs > 0 && (
                  <span className="flex size-4 items-center justify-center rounded-full bg-primary font-mono text-[9px] font-bold text-primary-foreground">
                    {pendingDiffs}
                  </span>
                )}
              </Button>

              <Button
                size="icon"
                variant="ghost"
                className="relative size-8"
                aria-label="Notifications"
                onClick={() =>
                  toast({ title: '3 unread signals', description: 'PR #184 regression · tokio duplicates · EXP-015 running' })
                }
              >
                <Bell className="size-4" />
                <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary font-mono text-[9px] font-bold text-primary-foreground">
                  3
                </span>
              </Button>
            </div>
          </div>

          {/* mobile nav */}
          <nav
            className="flex gap-1.5 overflow-x-auto border-t border-border/60 px-3 py-2 lg:hidden"
            aria-label="Ferrix views (mobile)"
          >
            {NAV.flatMap((g) => g.items).map((item) => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors',
                  activeView === item.id
                    ? 'border-primary/40 bg-primary/12 text-foreground'
                    : 'border-border/70 text-muted-foreground',
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        {/* content */}
        <main className="flex-1 px-4 py-5 sm:px-6">{children}</main>

        {/* sticky status footer */}
        <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/70 bg-sidebar/60 px-4 py-2 font-mono text-[10.5px] text-muted-foreground sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-foreground/80">FERRIX ENGINE v0.4.2</span>
            <span>{activeSummary ? `${activeSummary.crates} crates indexed` : 'indexing…'}</span>
            {activeSummary && <span>{activeSummary.edges} edges</span>}
            <span>graph updated 2m ago</span>
          </div>
          <div className="flex items-center gap-3">
            <StorageDialog>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded px-1 transition-colors hover:text-foreground"
                aria-label="Open storage report"
              >
                <HardDrive className="size-3" />
                storage 1.22 GB
              </button>
            </StorageDialog>
            <span className="hidden items-center gap-1.5 sm:flex">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
              engine live · up {uptimeLabel}
            </span>
            <span className="hidden sm:inline">reasoning: connected</span>
            <span>{clock}</span>
          </div>
        </footer>

        <CommandPalette
          open={paletteOpen}
          setOpen={setPaletteOpen}
          onNavigate={onNavigate}
          onRunScan={runScan}
          onOpenDiffs={() => setDiffOpen(true)}
          pendingDiffs={pendingDiffs}
        />
        <DiffQueueSheet open={diffOpen} onOpenChange={setDiffOpen} />
      </div>
    </div>
  )
}

export function NavBadgeHint() {
  return <Badge variant="outline">demo</Badge>
}
