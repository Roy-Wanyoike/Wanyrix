'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { History, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useScanStore, type ScanHistoryEntry } from '@/lib/ferrix/scan-store'
import { useWorkspaceStore } from '@/lib/ferrix/workspace-store'
import { MeasurementBadge, Panel } from './shared'

const TRIGGER_LABEL: Record<ScanHistoryEntry['trigger'], string> = {
  manual: 'doctor view',
  topbar: 'topbar',
  palette: '⌘K palette',
}

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/**
 * Per-workspace run log for `ferrix doctor` (issue #37).
 * Findings counts and build figures come from the doctor payload at scan
 * completion; duration is the client-measured wall clock of the terminal run.
 */
export function ScanHistoryPanel({ currentBuildTime }: { currentBuildTime: number }) {
  const activeWs = useWorkspaceStore((s) => s.active)
  const historyMap = useScanStore((s) => s.history)
  const clearHistory = useScanStore((s) => s.clearHistory)
  const history = useMemo(() => historyMap[activeWs] ?? [], [historyMap, activeWs])

  const maxFindings = Math.max(1, ...history.map((h) => h.findings))
  const TREND_RUNS = 14
  const trend = history.slice(0, TREND_RUNS).reverse() // oldest → newest for the bars

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <History className="size-3.5 text-primary" aria-hidden />
          Scan history
        </span>
      }
      subtitle="per-workspace run log · persisted locally · duration = terminal wall clock"
      actions={
        history.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[10.5px] text-muted-foreground"
            onClick={() => clearHistory(activeWs)}
          >
            <Trash2 className="size-3" />
            Clear
          </Button>
        ) : undefined
      }
    >
      {history.length === 0 ? (
        <div className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-center">
          <p className="text-sm text-muted-foreground">No scans recorded yet.</p>
          <p className="font-mono text-[10.5px] text-muted-foreground/70">
            run ferrix doctor — from here, the topbar, or ⌘K
          </p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
          {/* run rows */}
          <ul className="max-h-[264px] space-y-1.5 overflow-y-auto pr-1">
            {history.map((h, i) => {
              const delta = h.buildTime - currentBuildTime
              return (
                <motion.li
                  key={h.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.15), duration: 0.2 }}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-muted/10 px-3 py-2 transition-colors hover:border-border hover:bg-muted/25"
                >
                  <span className="font-mono text-[11px] tabular-nums text-foreground/80">
                    {TIME_FMT.format(h.at)}
                  </span>
                  <span className="rounded border border-border/60 bg-card px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground">
                    {TRIGGER_LABEL[h.trigger]}
                  </span>
                  <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-red-400" aria-hidden />
                    {h.critical}
                    <span className="mx-0.5 text-border">·</span>
                    <span className="size-1.5 rounded-full bg-amber-400" aria-hidden />
                    {h.warning}
                    <span className="mx-0.5 text-border">·</span>
                    <span className="size-1.5 rounded-full bg-teal-300" aria-hidden />
                    {h.info}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    findings <span className="tabular-nums text-foreground/85">{h.findings}</span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {h.buildTime.toFixed(1)}s measured
                    <span className="text-orange-300/90"> → {h.estimatedFrom}–{h.estimatedTo}s est.</span>
                  </span>
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground/70">
                    {(h.durationMs / 1000).toFixed(1)}s wall clock
                  </span>
                  {Math.abs(delta) > 0.05 && (
                    <MeasurementBadge status={delta < 0 ? 'measured' : 'estimated'} />
                  )}
                </motion.li>
              )
            })}
          </ul>

          {/* findings-per-run trend */}
          <div className="flex min-h-[120px] flex-col rounded-lg border border-border/60 bg-muted/10 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              findings per run
            </p>
            <div className="mt-3 flex flex-1 items-end gap-1.5" aria-hidden>
              {trend.map((h) => (
                <motion.div
                  key={h.id}
                  initial={{ height: 0 }}
                  animate={{ height: `${(h.findings / maxFindings) * 100}%` }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="min-h-[6px] flex-1 rounded-t-sm bg-gradient-to-t from-primary/40 to-primary"
                  title={`${h.findings} findings`}
                />
              ))}
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-border/50 pt-2 font-mono text-[10px] text-muted-foreground">
              <span>last {trend.length} runs</span>
              <span className="tabular-nums">
                {history[0]?.findings ?? 0} latest · peak {maxFindings}
              </span>
            </div>
          </div>
        </div>
      )}
      {history.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <RefreshCw className="size-3 shrink-0" aria-hidden />
          the engine replays the same telemetry each run in this demo — history tracks what the CLI
          would report across runs
        </p>
      )}
    </Panel>
  )
}
