'use client'

import { motion } from 'framer-motion'
import { ArrowDownRight, ArrowRight, ArrowUpRight, GitCompare, X } from 'lucide-react'
import type { ScanHistoryEntry } from '@/lib/wanyrix/scan-store'
import { cn } from '@/lib/utils'

/**
 * Run-to-run comparison (History view) — pick any two recorded runs and read
 * the MEASURED deltas between them. Every figure is arithmetic over what the
 * two runs actually recorded at completion time (doctor payload + client
 * wall clock); nothing is modeled or projected. When the engine replays the
 * same telemetry (demo environment) the honest result is a zero-delta row —
 * which is itself the claim being verified.
 */

export interface RunPairDeltas {
  findings: number
  critical: number
  warning: number
  info: number
  buildTime: number
  durationMs: number
}

export function diffRuns(a: ScanHistoryEntry, b: ScanHistoryEntry): RunPairDeltas {
  return {
    findings: b.findings - a.findings,
    critical: b.critical - a.critical,
    warning: b.warning - a.warning,
    info: b.info - a.info,
    buildTime: b.buildTime - a.buildTime,
    durationMs: b.durationMs - a.durationMs,
  }
}

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Good when the metric goes DOWN (findings, severities, times). */
type GoodWhenDown = true

function DeltaChip({
  label,
  delta,
  unit,
  format = (v: number) => `${v}`,
  goodWhenDown = true as GoodWhenDown,
}: {
  label: string
  delta: number
  unit?: string
  format?: (v: number) => string
  goodWhenDown?: boolean
}) {
  const neutral = delta === 0
  const good = goodWhenDown ? delta < 0 : delta > 0
  const Icon = delta === 0 ? ArrowRight : delta < 0 ? ArrowDownRight : ArrowUpRight
  return (
    <div
      className={cn(
        'rounded-lg border px-2.5 py-2 transition-colors',
        neutral
          ? 'border-border/60 bg-muted/10'
          : good
            ? 'border-teal-400/25 bg-teal-400/[0.06]'
            : 'border-red-400/25 bg-red-400/[0.06]',
      )}
    >
      <p className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 flex items-center gap-1 font-mono text-[13px] font-semibold tabular-nums',
          neutral ? 'text-muted-foreground' : good ? 'text-teal-300' : 'text-red-300',
        )}
      >
        <Icon className="size-3 shrink-0" aria-hidden />
        {delta > 0 ? '+' : ''}
        {format(delta)}
        {unit && <span className="text-[10px] font-normal text-muted-foreground">{unit}</span>}
      </p>
    </div>
  )
}

function PairValue({ entry, slot }: { entry: ScanHistoryEntry; slot: 'A' | 'B' }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
      <span
        className={cn(
          'inline-flex size-4 items-center justify-center rounded border font-mono text-[8.5px] font-bold',
          slot === 'A'
            ? 'border-primary/40 bg-primary/15 text-primary'
            : 'border-teal-400/40 bg-teal-400/15 text-teal-300',
        )}
      >
        {slot}
      </span>
      {TIME_FMT.format(entry.at)}
      <span className="text-border">·</span>
      <span className="tabular-nums">{entry.findings} findings</span>
      <span className="text-border">·</span>
      <span className="tabular-nums">{entry.buildTime.toFixed(1)}s build</span>
      <span className="text-border">·</span>
      <span className="tabular-nums">{(entry.durationMs / 1000).toFixed(1)}s wall</span>
    </span>
  )
}

export function ScanComparePanel({
  base,
  target,
  onClear,
}: {
  base: ScanHistoryEntry
  target: ScanHistoryEntry
  onClear: () => void
}) {
  const d = diffRuns(base, target)
  const pct = (from: number, delta: number) =>
    from === 0 ? null : `${delta > 0 ? '+' : ''}${((delta / from) * 100).toFixed(0)}% vs A`
  const allZero = Object.values(d).every((v) => v === 0)

  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      aria-label="Run comparison"
      className="rounded-lg border border-primary/25 bg-primary/[0.04] p-3"
    >
      <header className="mb-2.5 flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          <GitCompare className="size-3 text-primary" aria-hidden />
          A → B · measured deltas
        </p>
        <button
          type="button"
          onClick={onClear}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
          aria-label="Clear comparison selection"
        >
          <X className="size-3" aria-hidden />
          clear
        </button>
      </header>

      <div className="mb-2.5 flex flex-col gap-1 border-b border-border/50 pb-2.5">
        <PairValue entry={base} slot="A" />
        <PairValue entry={target} slot="B" />
      </div>

      {allZero ? (
        <p className="py-1 font-mono text-[11px] text-muted-foreground">
          no measurable change across any metric — the two runs recorded identical figures
          <span className="text-muted-foreground/70"> (expected when the engine replays the same telemetry)</span>
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <DeltaChip
              label="findings"
              delta={d.findings}
              format={(v) => `${v}`}
            />
            <DeltaChip label="critical" delta={d.critical} />
            <DeltaChip label="warning" delta={d.warning} />
            <DeltaChip label="info" delta={d.info} />
            <DeltaChip
              label="build"
              delta={d.buildTime}
              unit="s"
              format={(v) => v.toFixed(1)}
            />
            <DeltaChip
              label="wall clock"
              delta={d.durationMs}
              unit="s"
              format={(v) => (v / 1000).toFixed(1)}
            />
          </div>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[9.5px] text-muted-foreground/75">
            {pct(base.findings, d.findings) && <span>{pct(base.findings, d.findings)} findings</span>}
            {pct(base.buildTime, d.buildTime) && <span>{pct(base.buildTime, d.buildTime)} build</span>}
            {pct(base.durationMs, d.durationMs) && <span>{pct(base.durationMs, d.durationMs)} wall clock</span>}
            <span className="text-muted-foreground/60">
              est. range A {base.estimatedFrom}–{base.estimatedTo}s → B {target.estimatedFrom}–{target.estimatedTo}s
            </span>
          </p>
        </>
      )}
    </motion.section>
  )
}
