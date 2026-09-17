'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  Copy,
  FlaskConical,
  GitPullRequest,
  Lightbulb,
  RadioTower,
  RefreshCw,
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
import { useHealth } from '@/lib/ferrix/hooks'
import type { ActivityEvent, Severity } from '@/lib/ferrix/types'
import { CountUp, KpiCard, Panel, SectionHeading } from '../shared'
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

const TOOLTIP_STYLE = {
  backgroundColor: 'oklch(0.16 0.005 60)',
  border: '1px solid oklch(1 0 0 / 10%)',
  borderRadius: '10px',
  fontSize: '11px',
  boxShadow: '0 8px 24px oklch(0 0 0 / 40%)',
} as const

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
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

export default function OverviewView({ onNavigate }: ViewProps) {
  const { data: health, isLoading, isError, error, refetch } = useHealth()

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
    <div className="space-y-5">
      {/* ------------------------------------------------ 1) header */}
      <SectionHeading
        eyebrow="Engineering Health"
        title={health.workspace}
        description={`${health.crates} crates · ${health.edges} edges · ${health.toolchain}`}
        actions={
          <>
            <Badge
              variant="outline"
              className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
              scan live
            </Badge>
            <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">
              last scan {new Date(health.lastScan).toLocaleString()}
            </span>
            <Button size="sm" className="gap-1.5" onClick={() => onNavigate?.('doctor')}>
              Open Build Doctor
            </Button>
          </>
        }
      />

      {/* ------------------------------------------------ 2) KPI grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label={k.buildPerformance.label}
          value={<CountUp value={Math.abs(k.buildPerformance.delta)} suffix="%" />}
          delta={k.buildPerformance.delta}
          deltaSuffix="%"
          goodWhenDown
          hint="estimated, rolling 6 months"
          icon={<TrendingDown className="size-4" />}
          accent="primary"
        />
        <KpiCard
          label={k.ciCost.label}
          value={<CountUp value={Math.abs(k.ciCost.delta)} suffix="%" />}
          delta={k.ciCost.delta}
          deltaSuffix="%"
          goodWhenDown
          hint="spend per pipeline, rolling 6 months"
          icon={<CircleDollarSign className="size-4" />}
          accent="amber"
        />
        <KpiCard
          label={k.dependencyRisk.label}
          value={<CountUp value={Math.abs(k.dependencyRisk.delta)} suffix="%" />}
          delta={k.dependencyRisk.delta}
          deltaSuffix="%"
          goodWhenDown
          hint="duplicate + vulnerable surface"
          icon={<ShieldAlert className="size-4" />}
          accent="teal"
        />
        <KpiCard
          label={k.prRegressions.label}
          value={<CountUp value={k.prRegressions.count} />}
          hint="2 open · ferrix/build-impact"
          icon={<GitPullRequest className="size-4" />}
          accent="red"
        />
        <KpiCard
          label={k.architectureDebt.label}
          value={<CountUp value={k.architectureDebt.count} />}
          hint="oversized/fan-out crates"
          icon={<Boxes className="size-4" />}
          accent="amber"
        />
        <KpiCard
          label={k.runtimeBottlenecks.label}
          value={<CountUp value={k.runtimeBottlenecks.count} />}
          hint="async + memory signals"
          icon={<Activity className="size-4" />}
          accent="teal"
        />
      </div>

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

          {/* insight strip */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="flex items-start gap-2 text-[12.5px] leading-snug text-amber-200">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-400" />
              Average PR now causes 4.7× more compilation work than six months ago.
            </p>
            <div className="flex items-center gap-2">
              <ExplainDialog
                kind="impact"
                context={JSON.stringify({ buildTrend: health.buildTrend, kpis: health.kpis })}
                question="Why is the workspace build time trending up and what does it cost us?"
              />
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-xs text-amber-300 hover:text-amber-200"
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
                    <span className="w-32 shrink-0 truncate text-[13px] font-medium sm:w-40">
                      {crate.name}
                    </span>
                    {crate.downstream > 0 && (
                      <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
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
          <Panel title="CI cache hit rate" subtitle="ferrix storage · last 50 jobs">
            <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
              <CountUp value={health.cacheHitRate} suffix="%" />
            </p>
            <Progress
              value={health.cacheHitRate}
              className="mt-3 h-2 [&_[data-slot=progress-indicator]]:bg-red-400/80"
              aria-label="CI cache hit rate"
            />
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              34/50 jobs rebuilt the full graph last week — FER-DEP-006
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

          <Panel title="Live activity" subtitle="engine signals as they land" bodyClassName="max-h-[340px] overflow-y-auto">
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
                      aria-label={event.severity}
                    />
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
