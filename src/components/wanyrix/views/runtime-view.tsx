'use client'

import { useMemo } from 'react'
import { Activity, CircleSlash, Cpu, Gauge, HardDrive, RadioTower, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useDiagnostics, useDoctor, useHealth, useStorage } from '@/lib/wanyrix/hooks'
import type { AsyncSegment } from '@/lib/wanyrix/types'
import { CountUp, DataErrorPanel, MeasurementBadge, Panel, SectionHeading, ViewSkeleton } from '../shared'
import type { ViewProps } from '../view-types'

const SEGMENT_COLOR: Record<AsyncSegment['kind'], string> = {
  compute: 'bg-primary/70',
  db: 'bg-teal-400/70',
  network: 'bg-amber-400/70',
  background: 'bg-zinc-400/70',
  blocked: 'bg-red-400/80',
}

const TASK_STATE_STYLE: Record<string, string> = {
  running: 'text-primary border-primary/30 bg-primary/10',
  awaited: 'text-muted-foreground border-border bg-muted/20',
  resumed: 'text-teal-300 border-teal-500/30 bg-teal-500/10',
  done: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  blocked: 'text-red-300 border-red-500/30 bg-red-500/10',
}

/**
 * Runtime (AUDIT-I3 required surface) — HONEST runtime observations.
 *
 * What this environment actually has (all rendered from real payloads):
 *  - one captured async request profile (diagnostics route, measured segment
 *    timings) with tasks and warnings;
 *  - the engine's runtime-bottleneck KPI and Async-section findings;
 *  - local engine signals: storage footprint, retention and GC state.
 *
 * What this environment does NOT have: continuous runtime telemetry (CPU,
 * memory, p99 latency histograms…). That is not instrumented here and is
 * tracked in AUDIT-I8 — it is shown as an explicit empty state, never faked.
 */
export default function RuntimeView({ onNavigate }: ViewProps) {
  const diagnostics = useDiagnostics()
  const doctor = useDoctor()
  const health = useHealth()
  const storage = useStorage()

  const asyncFindings = useMemo(
    () => (doctor.data?.findings ?? []).filter((f) => f.section === 'Async'),
    [doctor.data],
  )

  if (diagnostics.isLoading) return <ViewSkeleton />
  if (diagnostics.isError || !diagnostics.data)
    return (
      <DataErrorPanel
        title="Runtime data unavailable"
        message={diagnostics.isError ? (diagnostics.error as Error).message : 'empty payload'}
        onRetry={() => diagnostics.refetch()}
      />
    )

  const request = diagnostics.data.request
  const totalMs = request.totalMs

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Runtime Observations"
        title="Runtime"
        description="What the engine actually observed about running code in this environment — captured profiles and local signals only."
        actions={
          <Button size="sm" variant="outline" onClick={() => onNavigate?.('diagnostics')}>
            Open Diagnostics
          </Button>
        }
      />

      {/* honesty banner */}
      <div className="flex flex-wrap items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <CircleSlash className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden />
        <p className="text-[12.5px] leading-relaxed text-amber-200/90">
          <strong className="text-amber-200">Not instrumented in this environment — tracked in AUDIT-I8.</strong>{' '}
          Continuous runtime telemetry (CPU, memory, latency percentiles, soak metrics) requires the Rust engine
          daemon, which is out of scope for this web-platform repo. Everything below is the deterministic data this
          environment genuinely has — nothing on this page is simulated telemetry.
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Runtime bottlenecks</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            {health.data ? <CountUp value={health.data.kpis.runtimeBottlenecks.count} /> : '—'}
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{health.data?.kpis.runtimeBottlenecks.label ?? 'async + memory signals'}</p>
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Captured request</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            <CountUp value={totalMs} decimals={1} suffix="ms" />
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {request.method} {request.path} · span <span className="font-mono">{request.id}</span>
          </p>
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Async findings</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            <CountUp value={asyncFindings.length} />
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Async-section doctor findings</p>
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Local storage bound</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
            {storage.data ? `${(storage.data.totalMB / 1024).toFixed(2)} GB` : '—'}
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{storage.data?.bound ?? 'engine-local artifacts'}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* captured request timeline */}
        <Panel
          className="lg:col-span-2"
          title="Captured async request profile"
          subtitle="measured segment timings from the diagnostics capture · the one profiled request in this environment"
          actions={<MeasurementBadge status="measured" />}
        >
          {/* timeline */}
          <div className="space-y-2">
            {request.segments.map((seg) => {
              const left = (seg.startMs / totalMs) * 100
              const width = Math.max(0.6, (seg.durationMs / totalMs) * 100)
              return (
                <div key={seg.id} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-[12px] font-medium sm:w-40">{seg.label}</span>
                  <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-border/30" aria-hidden>
                    <span
                      className={`absolute top-0.5 h-4 rounded-sm ${SEGMENT_COLOR[seg.kind]}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    {seg.durationMs.toFixed(1)}ms
                  </span>
                  <span className="hidden w-24 shrink-0 truncate font-mono text-[10px] text-muted-foreground/90 lg:block">
                    {seg.span}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 border-t border-border/60 pt-3 font-mono text-[10px] text-muted-foreground">
            {(Object.keys(SEGMENT_COLOR) as AsyncSegment['kind'][]).map((kind) => (
              <span key={kind} className="flex items-center gap-1.5">
                <span className={`size-2 rounded-sm ${SEGMENT_COLOR[kind]}`} aria-hidden />
                {kind}
              </span>
            ))}
          </div>

          {/* tasks */}
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
            {request.tasks.map((t) => (
              <Badge
                key={t.id}
                variant="outline"
                className={`gap-1 font-mono text-[10px] ${TASK_STATE_STYLE[t.state] ?? ''}`}
                title={t.detail}
              >
                {t.id} · {t.label} · {t.state}
              </Badge>
            ))}
          </div>

          {/* warnings */}
          <ul className="mt-4 space-y-1.5">
            {request.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-[12.5px] leading-snug text-amber-200">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-400" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-4">
          {/* local engine signals */}
          <Panel title="Local engine signals" subtitle="the runtime signals this environment really tracks">
            <ul className="space-y-3">
              <li className="flex items-start gap-2.5">
                <HardDrive className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-[13px] font-medium">
                    Storage {storage.data ? `${(storage.data.totalMB / 1024).toFixed(2)} GB` : ''}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {storage.data ? `${storage.data.retention} · last GC ${storage.data.lastGc}` : 'loading storage payload…'}
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <Gauge className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-[13px] font-medium">
                    CI cache hit {health.data ? `${health.data.cacheHitRate}%` : ''}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">sccache/CI telemetry over the last 50 jobs</p>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <RadioTower className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-[13px] font-medium">
                    {health.data?.toolchain ?? 'toolchain'}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">
                    build telemetry: {health.data ? `${health.data.crates} crates · ${health.data.edges} edges` : '…'}
                  </p>
                </div>
              </li>
            </ul>
            {asyncFindings.length > 0 && (
              <div className="mt-4 border-t border-border/60 pt-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  async findings
                </p>
                <ul className="mt-2 space-y-2">
                  {asyncFindings.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => onNavigate?.('findings')}
                        className="w-full rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2 text-left transition-colors hover:border-primary/30"
                      >
                        <span className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
                          {f.id}
                          <Badge variant="outline" className="font-mono text-[9px] text-amber-300">
                            {f.severity}
                          </Badge>
                          <MeasurementBadge status={f.measurementStatus} />
                        </span>
                        <span className="mt-1 block text-[12.5px] font-medium leading-snug">{f.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {/* explicit empty state — the honest part */}
          <Panel title="Continuous runtime telemetry" subtitle="not available here — no fabricated charts">
            <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center">
              <Cpu className="size-5 text-muted-foreground/60" aria-hidden />
              <p className="text-sm text-muted-foreground">Not instrumented in this environment.</p>
              <p className="max-w-[26ch] font-mono text-[10.5px] leading-relaxed text-muted-foreground/90">
                engine daemon telemetry (CPU · RSS · p95/p99 · soak) — tracked in AUDIT-I8
              </p>
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Activity className="mt-0.5 size-3 shrink-0" aria-hidden />
              Wanyrix never renders synthetic runtime metrics. When the daemon ships, this panel consumes real spans.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  )
}
