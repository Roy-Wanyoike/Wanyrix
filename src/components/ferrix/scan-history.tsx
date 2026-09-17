'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, FileJson, FileText, History, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { useScanStore, type ScanHistoryEntry } from '@/lib/ferrix/scan-store'
import { useWorkspaceStore } from '@/lib/ferrix/workspace-store'
import { cn } from '@/lib/utils'
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

type TrendMetric = 'findings' | 'duration'

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function exportJson(workspace: string, runs: ScanHistoryEntry[]) {
  return JSON.stringify(
    {
      schema: 'ferrix.scan-history/v1',
      workspace,
      exportedAt: new Date().toISOString(),
      note: 'client-side scan log for the web dashboard demo — durations are terminal wall clock; figures mirror the doctor payload (Gate 21: measured vs estimated labeled per run)',
      runs: runs.map((h) => ({
        id: h.id,
        at: new Date(h.at).toISOString(),
        trigger: h.trigger,
        findings: h.findings,
        critical: h.critical,
        warning: h.warning,
        info: h.info,
        buildTimeSeconds: h.buildTime,
        estimatedFromSeconds: h.estimatedFrom,
        estimatedToSeconds: h.estimatedTo,
        wallClockMs: h.durationMs,
      })),
    },
    null,
    2,
  )
}

function exportMarkdown(workspace: string, runs: ScanHistoryEntry[]): string {
  const rows = runs.map(
    (h) =>
      `| ${TIME_FMT.format(h.at)} | ${TRIGGER_LABEL[h.trigger]} | ${h.critical} / ${h.warning} / ${h.info} | ${h.findings} | ${h.buildTime.toFixed(1)}s | ${h.estimatedFrom}–${h.estimatedTo}s | ${(h.durationMs / 1000).toFixed(1)}s |`,
  )
  return [
    `# ferrix scan history — ${workspace}`,
    ``,
    `Exported ${new Date().toISOString()} · ${runs.length} run${runs.length === 1 ? '' : 's'} · client-side log (durations = terminal wall clock)`,
    ``,
    `| time | trigger | crit / warn / info | findings | build | estimated | wall clock |`,
    `|---|---|---|---|---|---|---|`,
    ...rows,
    ``,
    `---`,
    `_Ferrix export — the engine replays the same telemetry each run in this demo; history tracks what the CLI would report (Gate 11: human/JSON equivalence)._`,
  ].join('\n')
}

/**
 * Per-workspace run log for `ferrix doctor` (issue #37, extended by #44).
 * Findings counts and build figures come from the doctor payload at scan
 * completion; duration is the client-measured wall clock of the terminal run.
 */
export function ScanHistoryPanel({ currentBuildTime }: { currentBuildTime: number }) {
  const activeWs = useWorkspaceStore((s) => s.active)
  const historyMap = useScanStore((s) => s.history)
  const clearHistory = useScanStore((s) => s.clearHistory)
  const { toast } = useToast()
  const [metric, setMetric] = useState<TrendMetric>('findings')
  const history = useMemo(() => historyMap[activeWs] ?? [], [historyMap, activeWs])

  const TREND_RUNS = 14
  const trend = useMemo(() => history.slice(0, TREND_RUNS).reverse(), [history]) // oldest → newest for the bars
  const maxFindings = Math.max(1, ...history.map((h) => h.findings))
  const maxDuration = Math.max(1, ...history.map((h) => h.durationMs))
  const avgDuration = history.length
    ? history.reduce((acc, h) => acc + h.durationMs, 0) / history.length
    : 0
  const barValue = (h: ScanHistoryEntry) => (metric === 'findings' ? h.findings : h.durationMs)
  const barMax = metric === 'findings' ? maxFindings : maxDuration

  const doExport = (fmt: 'json' | 'md') => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    if (fmt === 'json') {
      downloadBlob(`${activeWs}-scan-history-${stamp}.json`, exportJson(activeWs, history), 'application/json')
    } else {
      downloadBlob(`${activeWs}-scan-history-${stamp}.md`, exportMarkdown(activeWs, history), 'text/markdown')
    }
    toast({
      title: `Scan history exported (${fmt.toUpperCase()})`,
      description: `${history.length} run${history.length === 1 ? '' : 's'} for ${activeWs} — nothing left the browser (Gate 28).`,
    })
  }

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
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-[10.5px] text-muted-foreground"
                  aria-label="Export scan history"
                >
                  <Download className="size-3" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  export · {activeWs}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => doExport('json')} className="gap-2 text-xs">
                  <FileJson className="size-3.5 text-primary" aria-hidden />
                  JSON · ferrix.scan-history/v1
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => doExport('md')} className="gap-2 text-xs">
                  <FileText className="size-3.5 text-primary" aria-hidden />
                  Markdown run table
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-[10.5px] text-muted-foreground"
              onClick={() => clearHistory(activeWs)}
            >
              <Trash2 className="size-3" />
              Clear
            </Button>
          </div>
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

          {/* per-run trend — findings or wall-clock duration (issue #44) */}
          <div className="flex min-h-[120px] flex-col rounded-lg border border-border/60 bg-muted/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                per run
              </p>
              <div
                className="flex rounded-md border border-border/70 bg-card p-0.5"
                role="group"
                aria-label="Trend metric"
              >
                {(['findings', 'duration'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={metric === m}
                    onClick={() => setMetric(m)}
                    className={cn(
                      'rounded-[5px] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide transition-colors',
                      metric === m
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {m === 'findings' ? 'finds' : 'time'}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative mt-3 flex flex-1 items-end gap-1.5" aria-hidden>
              {metric === 'duration' && trend.length > 1 && (
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-amber-400/50"
                  style={{ bottom: `${(avgDuration / maxDuration) * 100}%` }}
                />
              )}
              {trend.map((h) => (
                <motion.div
                  key={h.id}
                  initial={{ height: 0 }}
                  animate={{ height: `${(barValue(h) / barMax) * 100}%` }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className={cn(
                    'min-h-[6px] flex-1 rounded-t-sm',
                    metric === 'findings'
                      ? 'bg-gradient-to-t from-primary/40 to-primary'
                      : 'bg-gradient-to-t from-amber-500/30 to-amber-400',
                  )}
                  title={
                    metric === 'findings'
                      ? `${h.findings} findings`
                      : `${(h.durationMs / 1000).toFixed(1)}s wall clock`
                  }
                />
              ))}
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-border/50 pt-2 font-mono text-[10px] text-muted-foreground">
              <span>last {trend.length} runs</span>
              <span className="tabular-nums">
                {metric === 'findings'
                  ? `${history[0]?.findings ?? 0} latest · peak ${maxFindings}`
                  : `${(avgDuration / 1000).toFixed(1)}s avg · ${(maxDuration / 1000).toFixed(1)}s peak`}
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
