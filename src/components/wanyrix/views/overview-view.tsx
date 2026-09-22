'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Blocks,
  Boxes,
  CircleDollarSign,
  CircleSlash,
  Copy,
  FlaskConical,
  GitPullRequest,
  History as HistoryIcon,
  Lightbulb,
  ListChecks,
  RadioTower,
  RefreshCw,
  Route,
  Settings,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useDoctor,
  useExperiments,
  useGraph,
  useHealth,
  usePRAnalysis,
  useWorkspaces,
} from '@/lib/wanyrix/hooks'
import { useScanStore } from '@/lib/wanyrix/scan-store'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import { mergeWorkspaceRegistry } from '@/lib/wanyrix/registered-workspace'
import type { ActivityEvent, GraphPayload, Severity } from '@/lib/wanyrix/types'
import {
  CountUp,
  FixtureDataBanner,
  KpiCard,
  MeasurementBadge,
  Panel,
  Reveal,
  SectionHeading,
  StatusDot,
} from '../shared'
import { ExplainDialog } from '../explain-dialog'
import type { ViewProps } from '../view-types'

const MONO = 'var(--font-mono)'

const KIND_ICONS: Record<ActivityEvent['kind'], React.ComponentType<{ className?: string }>> = {
  regression: AlertTriangle,
  duplicate: Copy,
  amplification: RadioTower,
  improvement: TrendingUp,
  config: Settings,
  experiment: FlaskConical,
}

const SEVERITY_DOT_CLASS: Record<Severity, string> = {
  critical: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-teal-300',
}

/* Workspace accent dots — same token families as app-shell WS_ACCENT (§30 card). */
const WS_DOT: Record<'primary' | 'emerald' | 'zinc', string> = {
  primary: 'bg-primary',
  emerald: 'bg-emerald-400',
  zinc: 'bg-zinc-400',
}

const TOOLTIP_STYLE = {
  backgroundColor: 'oklch(0.16 0.005 60)',
  border: '1px solid oklch(1 0 0 / 10%)',
  borderRadius: '10px',
  fontSize: '11px',
  boxShadow: '0 8px 24px oklch(0 0 0 / 40%)',
} as const

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[340px] rounded-xl lg:col-span-2" />
        <Skeleton className="h-[340px] rounded-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[280px] rounded-xl lg:col-span-2" />
        <Skeleton className="h-[280px] rounded-xl" />
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Panel title="Health data unavailable">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-red-300">
          Failed to load engineering health: <span className="font-mono text-xs">{message}</span>
        </p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    </Panel>
  )
}

/* ================================================================== §30
 * Promise cards (pending-task §30 "Repository overview should expose") —
 * one glance per promise, each deep-linking into its first-class view.
 * Data comes ONLY from already-served payloads (health/graph/doctor/pr/
 * experiments/workspaces) + the local scan-history store; every figure is
 * honest about its source, and empty states are never zeros-as-data.
 * ================================================================== */

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

/* Relative time for scan/registry timestamps. Future-dated payloads render
 * absolute (never clamped into a fake "just now"). */
function relMs(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 0) return new Date(ms).toLocaleString()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ms).toLocaleDateString()
}

function relIso(iso: string): string {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? iso : relMs(t)
}

/**
 * Longest upstream dependency chain ending at the workspace's slowest crate,
 * computed client-side from the SERVED edge list (edge = dependent → dependency,
 * so walking out-edges walks upstream). Per-crate `buildTime` is telemetry, but
 * the summed chain duration is a serial projection — labeled ESTIMATED (Gate 21).
 * Memoized DAG walk with a defensive cycle guard.
 */
interface UpstreamChain {
  target: string
  seconds: number
  crates: string[]
}

function computeUpstreamChain(graph: GraphPayload): UpstreamChain | null {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const depsOf = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    depsOf.set(e.from, [...(depsOf.get(e.from) ?? []), e.to])
  }
  const workspaceNodes = graph.nodes.filter((n) => n.kind === 'workspace')
  if (workspaceNodes.length === 0) return null
  const target = workspaceNodes.reduce((a, b) => (b.buildTime > a.buildTime ? b : a))

  const memo = new Map<string, { crates: string[]; seconds: number }>()
  const inProgress = new Set<string>()
  const best = (id: string): { crates: string[]; seconds: number } => {
    const hit = memo.get(id)
    if (hit) return hit
    const self = byId.get(id)!
    if (inProgress.has(id)) return { crates: [id], seconds: self.buildTime } // cycle guard
    inProgress.add(id)
    let bestSub: { crates: string[]; seconds: number } = { crates: [], seconds: 0 }
    for (const dep of depsOf.get(id) ?? []) {
      const cand = best(dep)
      if (cand.seconds > bestSub.seconds) bestSub = cand
    }
    inProgress.delete(id)
    const res = { crates: [id, ...bestSub.crates], seconds: self.buildTime + bestSub.seconds }
    memo.set(id, res)
    return res
  }

  const result = best(target.id)
  return { target: target.id, seconds: result.seconds, crates: result.crates }
}

/* ------------------------------------------------------------ card frame */

function PromiseCardSkeleton() {
  return (
    <div
      className="flex min-h-[132px] flex-col rounded-xl border border-border/80 bg-card p-4"
      aria-hidden
    >
      <span className="flex items-center gap-2">
        <Skeleton className="size-4 rounded-full" />
        <Skeleton className="h-3 w-24" />
      </span>
      <span className="mt-4 flex-1">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-2.5 h-3 w-full max-w-[220px]" />
      </span>
      <span className="mt-3 flex items-center justify-between border-t border-border/60 pt-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-16" />
      </span>
    </div>
  )
}

/**
 * One §30 promise. The WHOLE card is the deep-link (single interactive
 * element, ≥44px touch target by construction), with hover/focus rings.
 * Body slots: data · honest empty state · honest error — never a bare 0.
 */
function PromiseCard({
  label,
  icon: Icon,
  accent,
  footnote,
  action,
  onOpen,
  loading = false,
  children,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
  footnote: string
  action: string
  onOpen: () => void
  loading?: boolean
  children: React.ReactNode
}) {
  if (loading) return <PromiseCardSkeleton />
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex h-full min-h-[132px] w-full flex-col rounded-xl border border-border/80 bg-card p-4 text-left transition-all duration-200 hover:border-primary/40 hover:shadow-[0_0_24px_-8px_oklch(0.72_0.16_45/30%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className={`size-4 shrink-0 ${accent}`} aria-hidden />
        <span className="text-xs font-medium">{label}</span>
      </span>
      <span className="mt-3 flex-1">{children}</span>
      <span className="mt-3 flex min-h-11 items-center justify-between gap-2 border-t border-border/60 pt-1.5">
        <span className="truncate text-[11px] leading-tight text-muted-foreground">{footnote}</span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary transition-transform duration-150 group-hover:translate-x-0.5">
          {action}
          <ArrowRight className="size-3.5" aria-hidden />
        </span>
      </span>
    </button>
  )
}

/** Honest in-card empty state — explains what's missing and how to fill it. */
function CardEmpty({ children }: { children: React.ReactNode }) {
  return <span className="block text-[12px] leading-snug text-muted-foreground">{children}</span>
}

/** Honest in-card failure — names the payload that failed, keeps the link. */
function CardError({ message }: { message: string }) {
  return (
    <span className="block text-[12px] leading-snug text-red-800 dark:text-red-300">
      Payload failed to load (<span className="font-mono text-[11px]">{message}</span>) — open the
      linked view for the full surface.
    </span>
  )
}

/* ------------------------------------------------------- 1) critical path */

function CriticalPathCard({ onNavigate }: ViewProps) {
  const { data, isLoading, isError, error } = useGraph()
  const chain = useMemo(() => (data ? computeUpstreamChain(data) : null), [data])
  return (
    <PromiseCard
      label="Critical path"
      icon={Route}
      accent="text-primary"
      footnote={chain ? `longest upstream chain to ${chain.target}` : 'slowest crate upstream chain'}
      action="Open graph"
      onOpen={() => onNavigate?.('graph')}
      loading={isLoading}
    >
      {isError ? (
        <CardError message={(error as Error).message} />
      ) : !chain ? (
        <CardEmpty>No workspace crates in the served graph for this workspace.</CardEmpty>
      ) : (
        <span className="block">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
              {chain.seconds.toFixed(1)}s
            </span>
            <MeasurementBadge status="estimated" />
          </span>
          <span
            className="mt-2 block truncate font-mono text-[11px] leading-relaxed text-muted-foreground"
            title={chain.crates.join(' → ')}
          >
            {chain.crates.slice(0, 3).join(' → ')}
            {chain.crates.length > 3 ? ` → +${chain.crates.length - 3} more` : ''}
          </span>
          <span className="mt-1.5 block text-[11px] leading-snug text-muted-foreground">
            {chain.crates.length}-crate serial projection from per-crate build telemetry — not a
            wall-clock measurement (Gate 21).
          </span>
        </span>
      )}
    </PromiseCard>
  )
}

/* ------------------------------------------------------ 2) top findings */

function TopFindingsCard({ onNavigate }: ViewProps) {
  const { data, isLoading, isError, error } = useDoctor()
  const top = useMemo(
    () =>
      [...(data?.findings ?? [])]
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.confidence - a.confidence)
        .slice(0, 3),
    [data],
  )
  return (
    <PromiseCard
      label="Top findings"
      icon={ListChecks}
      accent="text-red-400"
      footnote={data ? `${data.findings.length} findings · evidence-backed (Gate 8)` : 'top findings by severity'}
      action="Open findings"
      onOpen={() => onNavigate?.('findings')}
      loading={isLoading}
    >
      {isError ? (
        <CardError message={(error as Error).message} />
      ) : top.length === 0 ? (
        <CardEmpty>No findings reported for this workspace.</CardEmpty>
      ) : (
        <span className="block space-y-1.5">
          {top.map((f) => (
            <span key={f.id} className="flex items-center gap-2">
              <span
                className={`size-2 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[f.severity]}`}
                aria-hidden="true"
              />
              <span className="sr-only">{f.severity}: </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{f.title}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{f.id}</span>
            </span>
          ))}
        </span>
      )}
    </PromiseCard>
  )
}

/* --------------------------------------------------- 3) dependency risk */

function DependencyRiskCard({ onNavigate }: ViewProps) {
  const { data, isLoading, isError, error } = useGraph()
  const dupes = data?.duplicates.length ?? 0
  const upgrades = data?.catalog?.upgrades.length ?? 0
  return (
    <PromiseCard
      label="Dependency risk"
      icon={Copy}
      accent="text-amber-400"
      footnote="from the served graph payload"
      action="Open dependencies"
      onOpen={() => onNavigate?.('dependencies')}
      loading={isLoading}
    >
      {isError ? (
        <CardError message={(error as Error).message} />
      ) : dupes === 0 && upgrades === 0 ? (
        <CardEmpty>No duplicate versions or pending upgrade scenarios detected.</CardEmpty>
      ) : (
        <span className="flex gap-6">
          <span>
            <span className="block font-mono text-2xl font-semibold tabular-nums tracking-tight">
              {dupes}
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              duplicate version groups
            </span>
          </span>
          <span>
            <span className="block font-mono text-2xl font-semibold tabular-nums tracking-tight">
              {upgrades}
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              upgrade scenarios
            </span>
          </span>
        </span>
      )}
    </PromiseCard>
  )
}

/* ------------------------------------------------------- 4) architecture */

function ArchitectureCard({ onNavigate }: ViewProps) {
  const { data, isLoading, isError, error } = useGraph()
  const workspaceCrates = (data?.nodes ?? []).filter((n) => n.kind === 'workspace')
  // Same heuristic as architecture-view (fan-in × churn), so the counts agree.
  const hotspots = workspaceCrates.filter((n) => n.fanIn >= 3 && n.changeFreq >= 5).length
  return (
    <PromiseCard
      label="Architecture"
      icon={Blocks}
      accent="text-teal-300"
      footnote={`${workspaceCrates.length} workspace crates served`}
      action="Open architecture"
      onOpen={() => onNavigate?.('architecture')}
      loading={isLoading}
    >
      {isError ? (
        <CardError message={(error as Error).message} />
      ) : workspaceCrates.length === 0 ? (
        <CardEmpty>No workspace crates in the served graph for this workspace.</CardEmpty>
      ) : (
        <span className="block">
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
              {hotspots}
            </span>
            <span className="text-[11px] text-muted-foreground">hotspot crates</span>
          </span>
          <span className="mt-2 block text-[11px] leading-snug text-muted-foreground">
            fan-in × churn heuristic (INFERRED client-side) — not an engine measurement.
          </span>
        </span>
      )}
    </PromiseCard>
  )
}

/* ----------------------------------------------------- 5) recent changes */

function RecentChangesCard({ onNavigate }: ViewProps) {
  const workspacesQ = useWorkspaces()
  const activeWs = useWorkspaceStore((s) => s.active)
  const recordedRuns = useScanStore((s) => s.runs[activeWs]) // structured runs (Task 3-b)
  const legacyEntries = useScanStore((s) => s.history[activeWs]) // legacy history log
  // Prefer the structured scan-run log; fall back to the legacy history entries
  // so the card is honest whichever log the browser has accumulated.
  const entries: { key: string; label: string; at: number }[] = (recordedRuns ?? [])
    .slice(0, 2)
    .map((r) => ({
      key: r.id,
      label: `${r.findingCount} findings · ${r.trigger} run`,
      at: r.finishedAt,
    }))
  if (entries.length === 0) {
    entries.push(
      ...(legacyEntries ?? [])
        .slice(0, 2)
        .map((e) => ({ key: e.id, label: `${e.findings} findings · ${e.trigger} run`, at: e.at })),
    )
  }
  // QA-5-B-1: the card lists the MERGED registry — connected projects first
  const registry = useMemo(() => mergeWorkspaceRegistry(workspacesQ.data), [workspacesQ.data])
  return (
    <PromiseCard
      label="Recent changes"
      icon={HistoryIcon}
      accent="text-primary"
      footnote="local scan-run log + registry timestamps"
      action="Open history"
      onOpen={() => onNavigate?.('history')}
      loading={workspacesQ.isLoading}
    >
      <span className="block space-y-2">
        {entries.length === 0 ? (
          <CardEmpty>
            No scans recorded in this browser yet — run a scan (topbar or Build Doctor) to start the
            local log.
          </CardEmpty>
        ) : (
          entries.map((e) => (
            <span key={e.key} className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{e.label}</span>
              <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                {relMs(e.at)}
              </span>
            </span>
          ))
        )}
        {registry.length > 0 && (
          <span className="block space-y-1 border-t border-border/60 pt-2">
            {registry.map((w) => (
              <span key={w.id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <span className={`size-1.5 shrink-0 rounded-full ${WS_DOT[w.accent]}`} aria-hidden />
                  <span className="truncate">{w.name}</span>
                </span>
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  last scan {relIso(w.lastScan)}
                </span>
              </span>
            ))}
          </span>
        )}
      </span>
    </PromiseCard>
  )
}

/* --------------------------------------------------------- 6) regressions */

function RegressionsCard({ onNavigate }: ViewProps) {
  const { data, isLoading, isError, error } = usePRAnalysis()
  const check = data?.checks.find((c) => c.name === 'wanyrix/build-impact')
  const hasGuard = Boolean(data && check)
  return (
    <PromiseCard
      label="Regressions"
      icon={GitPullRequest}
      accent="text-red-400"
      footnote={data ? `PR #${data.number} regression guard` : 'PR regression guard'}
      action={hasGuard ? 'Open PR analysis' : 'Run PR analysis'}
      onOpen={() => onNavigate?.('prs')}
      loading={isLoading}
    >
      {isError ? (
        <CardError message={(error as Error).message} />
      ) : !data || !check ? (
        <CardEmpty>No regression guard data — run PR analysis to populate the guard.</CardEmpty>
      ) : (
        <span className="block">
          <span className="flex items-center gap-2">
            <StatusDot status={check.status} />
            <span className="text-[12px] font-medium">
              {check.status === 'fail'
                ? 'Guard blocking'
                : check.status === 'running'
                  ? 'Guard running'
                  : 'Guard passing'}
            </span>
          </span>
          <span className="mt-2 block font-mono text-[11px] leading-relaxed text-muted-foreground">
            #{data.number} · +{data.regressionPct}% build · {data.affectedCrates} crates affected
          </span>
        </span>
      )}
    </PromiseCard>
  )
}

/* -------------------------------------------------------- 7) experiments */

function ExperimentsCard({ onNavigate }: ViewProps) {
  const { data, isLoading, isError, error } = useExperiments()
  const experiments = data?.experiments ?? []
  const running = experiments.filter((e) => e.status === 'running').length
  const verified = experiments.filter((e) => e.status === 'verified').length
  return (
    <PromiseCard
      label="Experiments"
      icon={FlaskConical}
      accent="text-teal-300"
      footnote={`${experiments.length} experiments tracked`}
      action="Open experiments"
      onOpen={() => onNavigate?.('experiments')}
      loading={isLoading}
    >
      {isError ? (
        <CardError message={(error as Error).message} />
      ) : experiments.length === 0 ? (
        <CardEmpty>No experiments recorded yet — create one from a finding.</CardEmpty>
      ) : (
        <span className="flex gap-6">
          <span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
                {running}
              </span>
              <StatusDot status="running" />
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">running</span>
          </span>
          <span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
                {verified}
              </span>
              <StatusDot status="pass" />
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">✓ verified</span>
          </span>
        </span>
      )}
    </PromiseCard>
  )
}

/* ------------------------------------------------------------- 8) runtime */

function RuntimeCard({ onNavigate }: ViewProps) {
  return (
    <PromiseCard
      label="Runtime"
      icon={CircleSlash}
      accent="text-amber-400"
      footnote="honest empty state — AUDIT-I8"
      action="Open runtime"
      onOpen={() => onNavigate?.('runtime')}
    >
      <CardEmpty>
        Continuous runtime telemetry is not instrumented in this environment (tracked in AUDIT-I8).
        Captured async request profiles and local engine signals only — never fabricated metrics.
      </CardEmpty>
    </PromiseCard>
  )
}

/* ------------------------------------------------------------ promise row */

function PromiseCards({ onNavigate }: ViewProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Reveal delay={0.03}>
        <CriticalPathCard onNavigate={onNavigate} />
      </Reveal>
      <Reveal delay={0.06}>
        <TopFindingsCard onNavigate={onNavigate} />
      </Reveal>
      <Reveal delay={0.09}>
        <DependencyRiskCard onNavigate={onNavigate} />
      </Reveal>
      <Reveal delay={0.12}>
        <ArchitectureCard onNavigate={onNavigate} />
      </Reveal>
      <Reveal delay={0.15}>
        <RecentChangesCard onNavigate={onNavigate} />
      </Reveal>
      <Reveal delay={0.18}>
        <RegressionsCard onNavigate={onNavigate} />
      </Reveal>
      <Reveal delay={0.21}>
        <ExperimentsCard onNavigate={onNavigate} />
      </Reveal>
      <Reveal delay={0.24}>
        <RuntimeCard onNavigate={onNavigate} />
      </Reveal>
    </div>
  )
}

/* ================================================================== view */

export default function OverviewView({ onNavigate }: ViewProps) {
  const { data: health, isLoading, isError, error, refetch } = useHealth()
  /* QA-5-B-4: the Overview must say when the ACTIVE workspace is synthetic —
     the demo fixtures ship `fixtureOnly: true` from the registry API. */
  const workspacesQ = useWorkspaces()
  const activeWs = useWorkspaceStore((s) => s.active)
  const activeIsFixture = (workspacesQ.data?.workspaces ?? []).some(
    (w) => w.id === activeWs && w.fixtureOnly === true,
  )

  const findingTotal = useMemo(
    () => (health ? health.findingCounts.reduce((acc, f) => acc + f.count, 0) : 0),
    [health],
  )

  const maxSlowest = useMemo(
    () => (health ? Math.max(...health.slowestCrates.map((c) => c.seconds), 1) : 1),
    [health],
  )

  if (isLoading) return <LoadingSkeleton />
  if (isError || !health)
    return (
      <ErrorState
        message={isError ? (error as Error).message : 'empty payload'}
        onRetry={() => refetch()}
      />
    )

  const k = health.kpis

  return (
    <div className="space-y-6">
      {/* QA-5-B-4: provenance banner comes FIRST — within 60 seconds the page
          must say the data is sample data and offer the path to real data. */}
      {activeIsFixture && (
        <FixtureDataBanner onNavigateRepositories={() => onNavigate?.('repositories')} />
      )}

      {/* ------------------------------------------------ 1) header */}
      <SectionHeading
        eyebrow="Engineering Health"
        title={health.workspace}
        description={`${health.crates} crates · ${health.edges} edges · ${health.toolchain}`}
        actions={
          <>
            {activeIsFixture ? (
              <Badge
                variant="outline"
                title="synthetic demo data — not engine measurements"
                className="gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
              >
                <span className="size-1.5 rounded-full bg-amber-400" />
                demo data
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              >
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                scan live
              </Badge>
            )}
            <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">
              last scan {new Date(health.lastScan).toLocaleString()}
            </span>
            <Button size="sm" className="gap-1.5" onClick={() => onNavigate?.('doctor')}>
              Open Build Doctor
            </Button>
          </>
        }
      />

      {/* ------------------------------------------------ 2) KPI grid — staggered entrance (round 10) */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {[
          <KpiCard
            key="bp"
            label={k.buildPerformance.label}
            value={<CountUp value={Math.abs(k.buildPerformance.delta)} suffix="%" />}
            delta={k.buildPerformance.delta}
            deltaSuffix="%"
            goodWhenDown
            hint="estimated, rolling 6 months"
            icon={<TrendingDown className="size-4" />}
            accent="primary"
          />,
          <KpiCard
            key="cc"
            label={k.ciCost.label}
            value={<CountUp value={Math.abs(k.ciCost.delta)} suffix="%" />}
            delta={k.ciCost.delta}
            deltaSuffix="%"
            goodWhenDown
            hint="spend per pipeline, rolling 6 months"
            icon={<CircleDollarSign className="size-4" />}
            accent="amber"
          />,
          <KpiCard
            key="dr"
            label={k.dependencyRisk.label}
            value={<CountUp value={Math.abs(k.dependencyRisk.delta)} suffix="%" />}
            delta={k.dependencyRisk.delta}
            deltaSuffix="%"
            goodWhenDown
            hint="duplicate + vulnerable surface"
            icon={<ShieldAlert className="size-4" />}
            accent="teal"
          />,
          <KpiCard
            key="pr"
            label={k.prRegressions.label}
            value={<CountUp value={k.prRegressions.count} />}
            hint="2 open · wanyrix/build-impact"
            icon={<GitPullRequest className="size-4" />}
            accent="red"
          />,
          <KpiCard
            key="ad"
            label={k.architectureDebt.label}
            value={<CountUp value={k.architectureDebt.count} />}
            hint="oversized/fan-out crates"
            icon={<Boxes className="size-4" />}
            accent="amber"
          />,
          <KpiCard
            key="rb"
            label={k.runtimeBottlenecks.label}
            value={<CountUp value={k.runtimeBottlenecks.count} />}
            hint="async + memory signals"
            icon={<Activity className="size-4" />}
            accent="teal"
          />,
        ].map((card, i) => (
          <Reveal key={i} delay={0.05 * i}>
            {card}
          </Reveal>
        ))}
      </div>

      {/* ------------------------- 2.5) §30 promise cards — one glance per promise (Task 3-d).
          Build health is promised by the KPI row above; the eight cards below cover the rest
          of the §30 list, each deep-linking into its first-class view via onNavigate. */}
      <PromiseCards onNavigate={onNavigate} />

      {/* ------------------------------------------------ 3) trend + distribution */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Build time trend"
          subtitle="clean vs incremental · dev profile · months"
        >
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={health.buildTrend} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                <defs>
                  <linearGradient id="gradClean" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradIncremental" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 6%)" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: 'oklch(0.65 0.01 60)', fontFamily: MONO }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'oklch(0.65 0.01 60)', fontFamily: MONO }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: 'oklch(0.85 0.01 60)', fontFamily: MONO, marginBottom: 4 }}
                  itemStyle={{ fontFamily: MONO, fontSize: '11px', padding: 0 }}
                  cursor={{ stroke: 'oklch(1 0 0 / 14%)' }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="plainline" />
                <Area
                  type="monotone"
                  dataKey="clean"
                  name="clean build (s)"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill="url(#gradClean)"
                  fillOpacity={0.18}
                />
                <Area
                  type="monotone"
                  dataKey="incremental"
                  name="incremental (s)"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  fill="url(#gradIncremental)"
                  fillOpacity={0.18}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* insight strip — payload-driven copy (issue #34) */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="flex items-start gap-2 text-[12.5px] leading-snug text-amber-800 dark:text-amber-200">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-400" />
              {health.insight?.text ?? 'Build telemetry refreshed — open the Build Doctor for the latest evidence.'}
            </p>
            <div className="flex items-center gap-2">
              <ExplainDialog
                kind="impact"
                context={JSON.stringify({ buildTrend: health.buildTrend, kpis: health.kpis })}
                question={health.insight?.question ?? 'Why is the workspace build time trending up and what does it cost us?'}
              />
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-xs text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
                onClick={() => onNavigate?.('doctor')}
              >
                View findings →
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Finding distribution" subtitle="grouped by diagnostic section">
          <ul className="space-y-3.5">
            {health.findingCounts.map((row) => (
              <li key={row.section} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium">{row.section}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {row.count}
                  </span>
                </div>
                <Progress
                  value={(row.count / 12) * 100}
                  className="h-1.5"
                  aria-label={`${row.section}: ${row.count} findings`}
                />
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-border/60 pt-3 font-mono text-[11px] text-muted-foreground">
            {findingTotal} findings · all evidence-backed (Gate 8)
          </p>
        </Panel>
      </div>

      {/* ------------------------------------------------ 4) slowest crates + side stack */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Slowest crates in the critical path"
          subtitle="click a crate to inspect its blast radius"
        >
          <ul className="space-y-1">
            {health.slowestCrates.map((crate, i) => {
              const pct = (crate.seconds / maxSlowest) * 100
              return (
                <li key={crate.name}>
                  <button
                    type="button"
                    onClick={() => onNavigate?.('graph')}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/60"
                  >
                    <span className="w-5 shrink-0 font-mono text-[11px] text-muted-foreground">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="w-24 shrink-0 truncate text-[13px] font-medium sm:w-40">
                      {crate.name}
                    </span>
                    {crate.downstream > 0 && (
                      <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-800 dark:text-amber-400">
                        {crate.downstream} downstream
                      </span>
                    )}
                    <span className="mx-1 h-1.5 flex-1 overflow-hidden rounded-full bg-border/40">
                      <motion.span
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.9, delay: 0.08 * i, ease: 'easeOut' }}
                        className={`block h-full rounded-full ${i === 0 ? 'bg-primary/70' : 'bg-primary/40'}`}
                      />
                    </span>
                    <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums">
                      <CountUp value={crate.seconds} decimals={1} />
                      s
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel title="CI cache hit rate" subtitle="wanyrix storage · last 50 jobs">
            <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
              <CountUp value={health.cacheHitRate} suffix="%" />
            </p>
            <Progress
              value={health.cacheHitRate}
              className="mt-3 h-2 [&_[data-slot=progress-indicator]]:bg-red-400/80"
              aria-label="CI cache hit rate"
            />
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              34/50 jobs rebuilt the full graph last week — WAN-DEP-006
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => onNavigate?.('scorecard')}
            >
              Gate 6 status
            </Button>
          </Panel>

          <Panel title="Activity feed" subtitle="latest workspace signals" bodyClassName="max-h-[340px] overflow-y-auto" scrollableLabel="Activity feed">
            <ol className="relative space-y-4">
              {health.activity.map((event, i) => {
                const Icon = KIND_ICONS[event.kind]
                return (
                  <motion.li
                    key={event.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.07 }}
                    className="flex gap-2.5"
                  >
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[event.severity]}`}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{event.severity}: </span>
                    <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] font-medium leading-snug">{event.title}</p>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {event.time}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {event.detail}
                      </p>
                    </div>
                  </motion.li>
                )
              })}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  )
}
