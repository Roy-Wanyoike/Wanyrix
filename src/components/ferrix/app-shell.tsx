'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  Calculator,
  FlaskConical,
  GitPullRequest,
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
import type { ViewId } from '@/lib/ferrix/types'

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
  overview: { title: 'Engineering Health', sub: 'helios-platform · continuously analyzed' },
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
  const [clock, setClock] = useState<string>('')

  useEffect(() => {
    const update = () =>
      setClock(
        new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' local',
      )
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  const runScan = () => {
    queryClient.invalidateQueries()
    toast({
      title: 'Scan re-triggered',
      description: 'Ferrix engine is re-collecting cargo + git telemetry for helios-platform.',
    })
  }

  return (
    <div className="flex min-h-screen bg-background">
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
                        'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                        activeView === item.id
                          ? 'bg-primary/12 text-foreground ring-1 ring-primary/25'
                          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
                      )}
                    >
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
              <div className="relative hidden md:block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  placeholder="Search crates, findings, PRs…"
                  className="h-8 w-52 rounded-md border border-input bg-card pl-8 pr-2 text-xs outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-ring"
                  aria-label="Search"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      toast({ title: 'Search', description: 'Fuzzy search over the engineering graph lands next sprint.' })
                    }
                  }}
                />
              </div>

              <Select defaultValue="helios">
                <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Workspace">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="helios">helios-platform</SelectItem>
                  <SelectItem value="vertex">vertex-db</SelectItem>
                  <SelectItem value="ironmq">iron-mq</SelectItem>
                </SelectContent>
              </Select>

              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={runScan}>
                <RefreshCw className="size-3.5" />
                <span className="hidden sm:inline">Run scan</span>
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
            <span>47 crates indexed</span>
            <span>212 edges</span>
            <span>graph updated 2m ago</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
              engine live
            </span>
            <span className="hidden sm:inline">reasoning: connected</span>
            <span>{clock}</span>
          </div>
        </footer>
      </div>
    </div>
  )
}

export function NavBadgeHint() {
  return <Badge variant="outline">demo</Badge>
}
