'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { useQueryClient } from '@tanstack/react-query'
import {
  Braces,
  FileDiff,
  FileText,
  HardDrive,
  Loader2,
  Moon,
  RefreshCw,
  Search,
  Sun,
  TerminalSquare,
} from 'lucide-react'
const subscribeNoop = () => () => {}

import { cn } from '@/lib/utils'
import { WanyrixLogo } from './logo'
import { CommandPalette } from './command-palette'
import { DiffQueueSheet } from './diff-queue-sheet'
import { StorageDialog } from './storage-dialog'
import { NotificationsPopover } from './notifications-popover'
import { CliContractDialog } from './cli-dialog'
import { SystemStatusPill } from './system-status-pill'
import { NAV_GROUPS, VIEW_TITLES } from './nav-registry'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useReportExport, useWorkspaces } from '@/lib/wanyrix/hooks'
import { ENGINE_VERSION } from '@/lib/wanyrix/engine-meta'
import type { ReportFormat } from '@/lib/wanyrix/hooks'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import { useScanStore } from '@/lib/wanyrix/scan-store'
import { countPending, useDiffQueueStore } from '@/lib/wanyrix/diff-store'
import type { ViewId, WorkspaceSummary } from '@/lib/wanyrix/types'

const WS_ACCENT: Record<WorkspaceSummary['accent'], string> = {
  primary: 'bg-primary',
  emerald: 'bg-emerald-400',
  zinc: 'bg-zinc-400',
}

/**
 * Appearance toggle (issue #43) — dark is the terminal-native default;
 * light is the warm-paper daylight edition. Rendered only after mount to
 * avoid any SSR/client mismatch on the resolved theme.
 */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  // hydration flag without setState-in-effect: false during SSR/hydration,
  // true on the client afterwards
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  )

  const isDark = resolvedTheme !== 'light'
  // Pre-hydration renders use theme-neutral labels — resolvedTheme differs
  // between server and first client render, so anything theme-dependent must
  // wait for `mounted` or it triggers an attribute hydration mismatch.
  const label = mounted ? (isDark ? 'Switch to light appearance' : 'Switch to dark appearance') : 'Toggle appearance'
  const hint = mounted ? (isDark ? 'Daylight edition' : 'Terminal edition') : 'Toggle appearance'
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-8"
      aria-label={label}
      title={hint}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {mounted ? (
        isDark ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )
      ) : (
        <Moon className="size-4 opacity-0" aria-hidden />
      )}
    </Button>
  )
}

/* NAV + TITLES live in ./nav-registry (AUDIT-I3) — shared with the
   command palette so sidebar, palette and mobile nav can never drift. */
const NAV = NAV_GROUPS
const TITLES = VIEW_TITLES

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
  const [cliOpen, setCliOpen] = useState(false)

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

  /* workspace report export (round 9) — markdown + JSON flavors (round 10) */
  const reportMd = useReportExport('markdown')
  const reportJson = useReportExport('json')
  const reportPending = reportMd.isPending || reportJson.isPending

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
      description: `Wanyrix engine is re-collecting cargo + git telemetry for ${activeSummary?.name ?? 'the active workspace'}.`,
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

  const exportReport = (format: ReportFormat = 'markdown') => {
    const run = format === 'json' ? reportJson : reportMd
    run.mutate(undefined, {
      onSuccess: (b) =>
        toast({
          title: format === 'json' ? 'JSON snapshot downloaded' : 'Workspace report downloaded',
          description: `${b.filename} · ${(b.bytes / 1024).toFixed(1)} KB${
            format === 'json' ? ' · wanyrix report --json parity' : ' · doctor + graph + gates + storage'
          }`,
        }),
      onError: (e) =>
        toast({ title: 'Report export failed', description: e.message, variant: 'destructive' }),
    })
  }

  return (
    <div className="flex min-h-screen bg-background bg-grid">
      {/* a11y: skip link — visible on first Tab, jumps past the sidebar */}
      <a
        href="#main-content"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* ---------------- sidebar ---------------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border/70 bg-sidebar lg:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <WanyrixLogo size={30} />
          <div>
            <p className="text-sm font-bold tracking-tight">Wanyrix</p>
            <p className="font-mono text-[10px] text-muted-foreground">engineering intelligence</p>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Wanyrix views">
          {NAV.map((group, gi) => (
            <div key={group.group} className={gi > 0 ? 'border-t border-border/40 pt-4' : undefined}>
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
                          ? 'bg-primary/12 text-foreground ring-1 ring-primary/25 shadow-[0_0_20px_-6px_oklch(0.72_0.16_45/45%)]'
                          : 'text-muted-foreground hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-foreground',
                      )}
                    >
                      {activeView === item.id && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                      )}
                      <span className={cn(activeView === item.id ? 'text-primary' : 'opacity-70')}>
                        <item.icon className="size-4" aria-hidden />
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
          <button
            type="button"
            onClick={() => setCliOpen(true)}
            className="w-full rounded-md px-1 py-0.5 text-left font-mono text-[10px] leading-relaxed text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Open the wanyrix CLI contract reference"
            title="CLI contract — commands, --json, exit codes"
          >
            wanyrix engine v{ENGINE_VERSION}
            <br />
            local-first · AI optional
            <span className="mt-1 flex items-center gap-1 text-primary/80">
              <TerminalSquare className="size-3" aria-hidden />
              view CLI contract
            </span>
          </button>
        </div>
      </aside>

      {/* ---------------- main column ---------------- */}
      {/* min-w-0 lets the column shrink on mobile — without it the overflow-x
          nav's intrinsic min-content pins the whole app wider than the viewport. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-60">
        {/* topbar */}
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <WanyrixLogo size={24} />
              <span className="text-sm font-bold">Wanyrix</span>
            </div>
            <div className="hidden min-w-0 lg:block">
              <h2 className="truncate text-sm font-semibold">{TITLES[activeView].title}</h2>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{TITLES[activeView].sub}</p>
            </div>

            {/* flex-wrap + justify-end: at 390px the action cluster wraps onto a
                second row instead of overflowing the viewport (AUDIT-I3 regression
                guard while the topbar grew the status pill). */}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <SystemStatusPill onNavigate={onNavigate} />
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
                  className="h-8 w-[168px] max-w-[36vw] gap-1.5 text-xs"
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

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    disabled={reportPending}
                    aria-label={`Download workspace report for ${activeSummary?.name ?? 'active workspace'} (Markdown or JSON)`}
                    title="Workspace report — markdown findings/evidence/gates or machine-readable JSON (--json parity)"
                  >
                    {reportPending ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <FileText className="size-3.5" aria-hidden />
                    )}
                    <span className="hidden sm:inline">Report</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => exportReport('markdown')} className="gap-2 text-xs">
                    <FileText className="size-3.5 text-teal-300" aria-hidden />
                    <span className="flex-1">Markdown report</span>
                    <span className="font-mono text-[9px] text-muted-foreground">.md</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportReport('json')} className="gap-2 text-xs">
                    <Braces className="size-3.5 text-amber-400" aria-hidden />
                    <span className="flex-1">JSON snapshot</span>
                    <span className="font-mono text-[9px] text-muted-foreground">--json</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <NotificationsPopover onNavigate={onNavigate} />

              <ThemeToggle />
            </div>
          </div>

          {/* mobile nav — grouped chips (AUDIT-I3: 18 items need orientation).
              Items keep ≥44px touch targets (min-h-11). */}
          <nav
            className="flex items-center gap-1.5 overflow-x-auto border-t border-border/60 px-3 py-2 lg:hidden"
            aria-label="Wanyrix views (mobile)"
          >
            {NAV.map((group, gi) => (
              <div key={group.group} className="flex shrink-0 items-center gap-1.5">
                {gi > 0 && <span className="h-5 w-px shrink-0 bg-border/70" aria-hidden />}
                <span
                  className="shrink-0 self-center font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground/60"
                  aria-hidden
                >
                  {group.group}
                </span>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    aria-current={activeView === item.id ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs transition-colors',
                      activeView === item.id
                        ? 'border-primary/40 bg-primary/12 text-foreground'
                        : 'border-border/70 text-muted-foreground',
                    )}
                  >
                    <item.icon className="size-4" aria-hidden />
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </header>

        {/* content — tabIndex=-1 lets the skip-link anchor move keyboard focus here */}
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-5 outline-none sm:px-6">
          {children}
        </main>

        {/* sticky status footer */}
        <footer className="footer-hairline mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-sidebar/60 px-4 py-2 font-mono text-[10.5px] text-muted-foreground sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-foreground/80">WANYRIX ENGINE v{ENGINE_VERSION}</span>
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
          onExportReport={() => exportReport('markdown')}
          onExportJson={() => exportReport('json')}
          onOpenCli={() => setCliOpen(true)}
          pendingDiffs={pendingDiffs}
        />
        <DiffQueueSheet open={diffOpen} onOpenChange={setDiffOpen} />
        <CliContractDialog open={cliOpen} onOpenChange={setCliOpen} />
      </div>
    </div>
  )
}

export function NavBadgeHint() {
  return <Badge variant="outline">demo</Badge>
}
