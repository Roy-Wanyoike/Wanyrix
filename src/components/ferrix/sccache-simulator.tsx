'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Database, FlaskConical, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import type { DoctorReport } from '@/lib/ferrix/types'
import { CountUp, MeasurementBadge } from './shared'

/**
 * sccache build-economics simulator (issue #26).
 *
 * Grounded in the doctor payload: the critical path sums to the measured
 * build time, so the model scales every cacheable segment by (1 − hit)
 * and keeps linking + codegen (never cached) intact.
 * Baseline keeps `measured`; every simulated output is `estimated` (Gate 21).
 */

const CI_JOBS_PER_DAY = 50 // doctor telemetry phase: "50 jobs · 68% cache miss"
const CI_DAYS_PER_WEEK = 5

function currentCacheHitRate(report: DoctorReport): number {
  const phase = report.phases.find((p) => /cache miss/i.test(p.detail))
  if (!phase) return 32
  const m = phase.detail.match(/(\d+)% cache miss/i)
  return m ? 100 - Number(m[1]) : 32
}

export function SccacheSimulator({
  report,
  onNavigate,
}: {
  report: DoctorReport
  onNavigate?: () => void
}) {
  const current = useMemo(() => currentCacheHitRate(report), [report])
  const [hitRate, setHitRate] = useState(current)

  const model = useMemo(() => {
    const linker = report.criticalPath
      .filter((s) => s.kind === 'linker')
      .reduce((acc, s) => acc + s.seconds, 0)
    const cacheable = report.criticalPath
      .filter((s) => s.kind !== 'linker')
      .reduce((acc, s) => acc + s.seconds, 0)
    const cached = cacheable * (hitRate / 100)
    const recompiled = cacheable - cached
    const simulated = linker + recompiled
    const saved = Math.max(0, report.buildTime - simulated)
    return {
      linker,
      cacheable,
      cached,
      recompiled,
      simulated,
      saved,
      savedPct: (saved / report.buildTime) * 100,
      weeklyCiMinutes: (saved * CI_JOBS_PER_DAY * CI_DAYS_PER_WEEK) / 60,
    }
  }, [report, hitRate])

  const bar = [
    { key: 'from cache', seconds: model.cached, cls: 'bg-emerald-500/70' },
    { key: 'recompiled', seconds: model.recompiled, cls: 'bg-amber-500/70' },
    { key: 'link + codegen', seconds: model.linker, cls: 'bg-zinc-500/60' },
  ]
  const total = bar.reduce((a, b) => a + b.seconds, 0) || 1

  return (
    <section
      className="rounded-xl border border-border/80 bg-card"
      aria-label="sccache build-economics simulator"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Database className="size-4 text-primary" aria-hidden />
            Build economics — sccache simulator
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            drag the cache hit rate · model recomputed live from the critical path
          </p>
        </div>
        <MeasurementBadge status="estimated" />
      </header>

      <div className="grid gap-6 p-4 lg:grid-cols-[1fr_340px] lg:gap-8">
        {/* ------------------------------------------ left: slider + bars */}
        <div className="space-y-5">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="sccache-hit" className="text-xs font-medium text-muted-foreground">
                cache hit rate
              </label>
              <p className="font-mono text-sm tabular-nums">
                <span className="text-lg font-semibold text-emerald-300">{hitRate}%</span>
                {hitRate !== current && (
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    current: {current}% (measured · CI telemetry)
                  </span>
                )}
                {hitRate === current && (
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    = current (measured)
                  </span>
                )}
              </p>
            </div>
            <Slider
              id="sccache-hit"
              value={[hitRate]}
              min={0}
              max={90}
              step={1}
              onValueChange={(v) => setHitRate(v[0] ?? hitRate)}
              className="mt-3"
              aria-label="Cache hit rate"
            />
            <div className="mt-1 flex justify-between font-mono text-[9.5px] text-muted-foreground/70">
              <span>0%</span>
              <span>sccache realistic ceiling 90%</span>
              <span>90%</span>
            </div>
          </div>

          {/* composition bar */}
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              clean build composition @ {hitRate}% hit
            </p>
            <div className="flex h-9 w-full overflow-hidden rounded-lg border border-border/70 bg-background/60">
              {bar.map((seg) => (
                <motion.div
                  key={seg.key}
                  className={`h-full ${seg.cls}`}
                  initial={false}
                  animate={{ width: `${(seg.seconds / total) * 100}%` }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  title={`${seg.key}: ${seg.seconds.toFixed(1)}s`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {bar.map((seg) => (
                <span
                  key={seg.key}
                  className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground"
                >
                  <span className={`size-2 rounded-sm ${seg.cls}`} aria-hidden />
                  {seg.key}
                  <span className="tabular-nums text-foreground/80">
                    {seg.seconds.toFixed(1)}s
                  </span>
                </span>
              ))}
            </div>
          </div>

          <p className="flex items-start gap-1.5 rounded-lg border border-border/60 bg-background/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0 text-primary/70" aria-hidden />
            Model: linking + codegen is never cached; every other critical-path segment scales by
            (1 − hit rate). Baseline 87.4s is measured (cargo build --timings); all simulated
            outputs are estimates until a ferrix experiment verifies them (Gate 21).
          </p>
        </div>

        {/* ---------------------------------------- right: metric tiles */}
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Clean build @ {hitRate}% hit</p>
              <MeasurementBadge status="estimated" />
            </div>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-200">
              <CountUp value={model.simulated} decimals={1} duration={250} />
              s
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              vs {report.buildTime}s measured baseline
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border/70 bg-background/40 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Saved / clean build
              </p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-300">
                −<CountUp value={model.saved} decimals={1} duration={250} />
                s
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">
                −<CountUp value={model.savedPct} decimals={0} duration={250} />%
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/40 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Weekly CI saving
              </p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-300">
                <CountUp value={model.weeklyCiMinutes} decimals={0} duration={250} />
                min
              </p>
              <p className="font-mono text-[9.5px] leading-tight text-muted-foreground">
                assumes {CI_JOBS_PER_DAY} cacheable jobs/day × {CI_DAYS_PER_WEEK}d
              </p>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="mt-auto w-full gap-1.5"
            onClick={() => onNavigate?.()}
          >
            <FlaskConical className="size-3.5" aria-hidden />
            Create experiment to verify
          </Button>
        </div>
      </div>
    </section>
  )
}
