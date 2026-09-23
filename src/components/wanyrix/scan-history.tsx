'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Copy,
  Check,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  GitCompare,
  History,
  RefreshCw,
  Trash2,
} from 'lucide-react'
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
import { useScanStore, type ScanHistoryEntry } from '@/lib/wanyrix/scan-store'
import {
  buildClientScanHistoryExport,
  clientScanHistoryFilename,
} from '@/lib/wanyrix/flavors'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import { cn } from '@/lib/utils'
import { MeasurementBadge, Panel } from './shared'
import { ScanComparePanel } from './scan-compare'

const TRIGGER_LABEL: Record<ScanHistoryEntry['trigger'], string> = {
  manual: 'doctor view',
  topbar: 'topbar',
  palette: '⌘K palette',
  'engine-exec': 'engine exec',
}

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

type TrendMetric = 'findings' | 'duration'
type TriggerFilter = 'all' | ScanHistoryEntry['trigger']

const TRIGGER_FILTERS: { key: TriggerFilter; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'manual', label: 'doctor view' },
  { key: 'topbar', label: 'topbar' },
  { key: 'palette', label: '⌘K' },
  { key: 'engine-exec', label: 'engine' },
]

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
  // ENG-TCA-2 consolidation (Task 3-b): the download envelope is built by the
  // SAME run-mapper + envelope constructor the HTTP `?flavor=scan-history`
  // route uses. Only `note` and `runs` differ honestly from the server flavor
  // (client log = real local activity; server log stays empty — Gate 21).
  return JSON.stringify(buildClientScanHistoryExport(workspace, runs), null, 2)
}

function exportMarkdown(workspace: string, runs: ScanHistoryEntry[]): string {
  const rows = runs.map((h) => {
    const buildCell =
      h.buildTimeStatus === 'not-measured'
        ? `n/a (not measured) | – – s`
        : `${h.buildTime.toFixed(1)}s | ${h.estimatedFrom}–${h.estimatedTo}s`
    // issue #128: replay runs are marked IN the table, not only in a footnote
    const triggerCell = `${TRIGGER_LABEL[h.trigger]}${h.replay === true ? ' · REPLAY' : ''}`
    return `| ${TIME_FMT.format(h.at)} | ${triggerCell} | ${h.critical} / ${h.warning} / ${h.info} | ${h.findings} | ${buildCell} | ${(h.durationMs / 1000).toFixed(1)}s |`
  })
  return [
    `# wanyrix scan history — ${workspace}`,
    ``,
    `Exported ${new Date().toISOString()} · ${runs.length} run${runs.length === 1 ? '' : 's'} · client-side log (durations = terminal wall clock)`,
    ``,
    `| time | trigger | crit / warn / info | findings | build | estimated | wall clock |`,
    `|---|---|---|---|---|---|---|`,
    ...rows,
    ``,
    `---`,
    `_Wanyrix export — runs marked REPLAY re-stream the stored doctor report (engine binary not invoked by those runs); history tracks what the CLI would report (Gate 11: human/JSON equivalence)._`,
  ].join('\n')
}

/** Minimal CSV field escaping — quote when the value contains , " or \n. */
function csvField(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** R7: spreadsheet-friendly run table (fingerprint count column included). */
function exportCsv(runs: ScanHistoryEntry[]): string {
  const header = [
    'run_id',
    'time',
    'trigger',
    'replay',
    'critical',
    'warning',
    'info',
    'findings',
    'fingerprint_count',
    'fingerprint_truncated',
    'build_seconds',
    'build_time_status',
    'estimated_from_seconds',
    'estimated_to_seconds',
    'wall_clock_seconds',
  ].join(',')
  const rows = runs.map((h) =>
    [
      h.id,
      h.at,
      h.trigger,
      // issue #128: 'true' only when the row carries the replay marker —
      // legacy rows (marked before the field existed) stay empty, not false.
      h.replay === true ? 'true' : '',
      h.critical,
      h.warning,
      h.info,
      h.findings,
      h.findingIds?.length ?? '',
      h.findingIdsTruncated === true ? 'true' : 'false',
      h.buildTime.toFixed(1),
      h.buildTimeStatus ?? 'measured',
      h.estimatedFrom,
      h.estimatedTo,
      (h.durationMs / 1000).toFixed(1),
    ]
      .map(csvField)
      .join(','),
  )
  return [header, ...rows, ''].join('\n')
}

/**
 * Per-workspace run log for `wanyrix doctor` (issue #37, extended by #44).
 * Findings counts and build figures come from the doctor payload at scan
 * completion; duration is the client-measured wall clock of the terminal run.
 * R7: `onInspectFinding` enables explain drill-through from the Compare
 * panel's fingerprint diff (resolvable only against the CURRENT payload —
 * the parent owns that honesty).
 */
export function ScanHistoryPanel({
  currentBuildTime,
  onInspectFinding,
}: {
  currentBuildTime: number
  onInspectFinding?: (id: string) => void
}) {
  const activeWs = useWorkspaceStore((s) => s.active)
  const historyMap = useScanStore((s) => s.history)
  const clearHistory = useScanStore((s) => s.clearHistory)
  const { toast } = useToast()
  const [metric, setMetric] = useState<TrendMetric>('findings')
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all')
  const [compareMode, setCompareMode] = useState(false)
  const [baseId, setBaseId] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const history = useMemo(() => historyMap[activeWs] ?? [], [historyMap, activeWs])

  const filtered = useMemo(
    () => (triggerFilter === 'all' ? history : history.filter((h) => h.trigger === triggerFilter)),
    [history, triggerFilter],
  )
  const base = useMemo(() => history.find((h) => h.id === baseId) ?? null, [history, baseId])
  const target = useMemo(() => history.find((h) => h.id === targetId) ?? null, [history, targetId])

  const TREND_RUNS = 14
  const trend = useMemo(() => filtered.slice(0, TREND_RUNS).reverse(), [filtered]) // oldest → newest for the bars
  const maxFindings = Math.max(1, ...filtered.map((h) => h.findings))
  const maxDuration = Math.max(1, ...filtered.map((h) => h.durationMs))
  const avgDuration = filtered.length
    ? filtered.reduce((acc, h) => acc + h.durationMs, 0) / filtered.length
    : 0
  const barValue = (h: ScanHistoryEntry) => (metric === 'findings' ? h.findings : h.durationMs)
  const barMax = metric === 'findings' ? maxFindings : maxDuration

  const copyRunId = (id: string) => {
    if (!navigator.clipboard) {
      toast({ title: 'Copy failed', description: 'Clipboard is not available in this context.' })
      return
    }
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id)
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1400)
      toast({ title: 'Run id copied', description: id })
    })
  }

  /* A/B selection: first pick = A, second = B; further picks slide the
     window (old B becomes A). Clicking a selected row removes it. */
  const toggleSelect = (id: string) => {
    if (baseId === id) {
      setBaseId(targetId)
      setTargetId(null)
    } else if (targetId === id) {
      setTargetId(null)
    } else if (!baseId) {
      setBaseId(id)
    } else if (!targetId) {
      setTargetId(id)
    } else {
      setBaseId(targetId)
      setTargetId(id)
    }
  }

  const toggleCompare = () => {
    setCompareMode((v) => !v)
    setBaseId(null)
    setTargetId(null)
  }

  const doExport = (fmt: 'json' | 'md' | 'csv') => {
    const now = new Date()
    if (fmt === 'json') {
      // Consolidated exporter (ENG-TCA-2): filename + envelope both come from
      // flavors.ts so the download matches the HTTP flavor byte-for-byte.
      downloadBlob(
        clientScanHistoryFilename(activeWs, now),
        exportJson(activeWs, history),
        'application/json',
      )
    } else if (fmt === 'csv') {
      const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
      downloadBlob(
        `${activeWs}-scan-history-${stamp}.csv`,
        exportCsv(history),
        'text/csv',
      )
    } else {
      // Same stamp rule as the exporter: ISO → '-', 19 chars.
      const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
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
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-[10.5px] text-muted-foreground"
              onClick={toggleCompare}
              disabled={history.length < 2}
              aria-pressed={compareMode}
              title={
                history.length < 2
                  ? 'record at least two runs to compare'
                  : 'compare two runs side by side (measured deltas)'
              }
              aria-label="Compare two runs"
            >
              <GitCompare className="size-3" />
              Compare
            </Button>
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
                  JSON · wanyrix.scan-history/v1
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => doExport('md')} className="gap-2 text-xs">
                  <FileText className="size-3.5 text-primary" aria-hidden />
                  Markdown run table
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => doExport('csv')} className="gap-2 text-xs">
                  <FileSpreadsheet className="size-3.5 text-primary" aria-hidden />
                  CSV · spreadsheet run table
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
          <p className="font-mono text-[10.5px] text-muted-foreground/90">
            run wanyrix doctor — from here, the topbar, or ⌘K
          </p>
        </div>
      ) : (
        <>
          {compareMode && (
            <p className="mb-2.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground" aria-live="polite">
              <GitCompare className="size-3 shrink-0 text-primary" aria-hidden />
              {base
                ? target
                  ? 'pair selected — measured deltas below; click another run to slide the window'
                  : 'run A picked — now click run B'
                : 'pick run A, then run B — deltas are computed from what each run recorded'}
            </p>
          )}
          {base && target && (
            <div className="mb-3">
              <ScanComparePanel
                base={base}
                target={target}
                onClear={() => {
                  setBaseId(null)
                  setTargetId(null)
                }}
                onInspectFinding={onInspectFinding}
              />
            </div>
          )}
          <div
            className="mb-2.5 flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Filter runs by trigger"
          >
            {TRIGGER_FILTERS.map(({ key, label }) => {
              const count =
                key === 'all' ? history.length : history.filter((h) => h.trigger === key).length
              if (key !== 'all' && count === 0) return null
              const active = triggerFilter === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTriggerFilter(key)}
                  className={cn(
                    'rounded border px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-wide transition-colors',
                    active
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border/60 bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label} <span className="tabular-nums opacity-70">{count}</span>
                </button>
              )
            })}
            {triggerFilter !== 'all' && (
              <span className="ml-auto font-mono text-[9.5px] text-muted-foreground/90">
                {filtered.length} of {history.length} shown
              </span>
            )}
          </div>
          {filtered.length === 0 ? (
            <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border text-center">
              <p className="text-xs text-muted-foreground">No runs match this filter.</p>
            </div>
          ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
          {/* run rows */}
          <ul className="max-h-[264px] space-y-1.5 overflow-y-auto pr-1">
            {filtered.map((h, i) => {
              const notMeasured = h.buildTimeStatus === 'not-measured'
              const delta = notMeasured ? 0 : h.buildTime - currentBuildTime
              const slot = baseId === h.id ? 'A' : targetId === h.id ? 'B' : null
              return (
                <motion.li
                  key={h.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.15), duration: 0.2 }}
                  onClick={compareMode ? () => toggleSelect(h.id) : undefined}
                  role={compareMode ? 'button' : undefined}
                  tabIndex={compareMode ? 0 : undefined}
                  aria-pressed={compareMode ? slot !== null : undefined}
                  onKeyDown={
                    compareMode
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggleSelect(h.id)
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    'group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-muted/10 px-3 py-2 transition-colors hover:border-border hover:bg-muted/25',
                    compareMode && 'cursor-pointer focus-visible:outline focus-visible:outline-primary/60',
                    slot === 'A' &&
                      'border-primary/50 bg-primary/10 hover:border-primary/60 hover:bg-primary/15',
                    slot === 'B' &&
                      'border-teal-400/50 bg-teal-400/10 hover:border-teal-400/60 hover:bg-teal-400/15',
                  )}
                >
                  {slot && (
                    <span
                      className={cn(
                        'inline-flex size-4 shrink-0 items-center justify-center rounded border font-mono text-[8.5px] font-bold',
                        slot === 'A'
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-teal-400/40 bg-teal-400/15 text-teal-300',
                      )}
                    >
                      {slot}
                    </span>
                  )}
                  <span className="font-mono text-[11px] tabular-nums text-foreground/80">
                    {TIME_FMT.format(h.at)}
                  </span>
                  <span className="rounded border border-border/60 bg-card px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground">
                    {TRIGGER_LABEL[h.trigger]}
                  </span>
                  {h.replay === true && (
                    <span
                      title="replay of the stored doctor report — the engine binary was not invoked by this run"
                      className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-amber-800 dark:text-amber-400"
                    >
                      replay
                    </span>
                  )}
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
                    {notMeasured ? (
                      <span title="the real engine's doctor scan measures no build time (Gate 21)">
                        not measured
                      </span>
                    ) : (
                      <>
                        {h.buildTime.toFixed(1)}s measured
                        <span className="text-orange-300/90">
                          {' '}
                          → {h.estimatedFrom}–{h.estimatedTo}s est.
                        </span>
                      </>
                    )}
                  </span>
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground/90">
                    {(h.durationMs / 1000).toFixed(1)}s wall clock
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyRunId(h.id)
                    }}
                    className="hit-44 relative rounded p-1 text-muted-foreground/90 opacity-0 transition-all hover:bg-muted/40 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={`Copy run id ${h.id}`}
                    title={h.id}
                  >
                    {copiedId === h.id ? (
                      <Check className="size-3 text-teal-300" aria-hidden />
                    ) : (
                      <Copy className="size-3" aria-hidden />
                    )}
                  </button>
                  {Math.abs(delta) > 0.05 && (
                    <MeasurementBadge status={delta < 0 ? 'measured' : 'estimated'} />
                  )}
                  {notMeasured && (
                    <span className="rounded border border-border/60 bg-card px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground/90">
                      not-measured
                    </span>
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
                  ? `${filtered[0]?.findings ?? 0} latest · peak ${maxFindings}`
                  : `${(avgDuration / 1000).toFixed(1)}s avg · ${(maxDuration / 1000).toFixed(1)}s peak`}
              </span>
            </div>
          </div>
        </div>
          )}
        </>
      )}
      {history.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <RefreshCw className="size-3 shrink-0" aria-hidden />
          entries marked <span className="font-mono text-[10px] uppercase text-amber-800 dark:text-amber-400">replay</span> re-stream
          the stored doctor report (engine binary not invoked by those runs) — history tracks what
          the CLI would report across runs
        </p>
      )}
    </Panel>
  )
}
