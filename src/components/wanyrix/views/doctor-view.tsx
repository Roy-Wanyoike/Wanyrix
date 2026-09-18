'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Boxes,
  ChevronRight,
  ClipboardCopy,
  Copy,
  FileDiff,
  FlaskConical,
  RefreshCw,
  Settings,
  Terminal as TerminalIcon,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useDoctor, useRecordScanRun } from '@/lib/wanyrix/hooks'
import { useScanStore } from '@/lib/wanyrix/scan-store'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import { useToast } from '@/hooks/use-toast'
import { FindingSheet } from '../finding-sheet'
import { ScanHistoryPanel } from '../scan-history'
import { SccacheSimulator } from '../sccache-simulator'
import type {
  ConfidenceClass,
  CriticalPathSegment,
  DoctorReport,
  Finding,
  FindingSection,
  RemediationKind,
} from '@/lib/wanyrix/types'
import {
  ConfidenceBadge,
  CountUp,
  MeasurementBadge,
  Panel,
  SectionHeading,
  SeverityBadge,
  Terminal,
} from '../shared'
import { ExplainDialog } from '../explain-dialog'
import type { ViewProps } from '../view-types'

const MONO = 'var(--font-mono)'

const TOOLTIP_STYLE = {
  backgroundColor: 'oklch(0.16 0.005 60)',
  border: '1px solid oklch(1 0 0 / 10%)',
  borderRadius: '10px',
  fontSize: '11px',
  boxShadow: '0 8px 24px oklch(0 0 0 / 40%)',
} as const

const PATH_KIND_COLOR: Record<CriticalPathSegment['kind'], string> = {
  workspace: 'var(--chart-1)',
  'proc-macro': 'var(--chart-4)',
  external: 'var(--chart-2)',
  linker: 'oklch(0.55 0.01 60)',
}

const REMEDIATION_META: Record<RemediationKind, { icon: LucideIcon; label: string }> = {
  command: { icon: TerminalIcon, label: 'command' },
  config: { icon: Settings, label: 'config' },
  architecture: { icon: Boxes, label: 'architecture' },
  experiment: { icon: FlaskConical, label: 'experiment' },
  patch: { icon: FileDiff, label: 'patch' },
}

const SECTION_ORDER: FindingSection[] = ['Build', 'Workspace', 'IDE', 'CI', 'Async']

// experiment eligibility is payload-driven (Finding.experimentEligible, issue #34)

/** Confidence calibration (Gate 13) — derive the class from the numeric score. */
function confidenceClass(score: number): ConfidenceClass {
  if (score >= 95) return 'deterministic'
  if (score >= 75) return 'high'
  if (score >= 55) return 'medium'
  return 'estimated'
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-[300px] rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[132px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[330px] rounded-xl" />
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[230px] rounded-xl" />
        ))}
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Panel title="Doctor unavailable">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-red-300">
          Failed to run wanyrix doctor: <span className="font-mono text-xs">{message}</span>
        </p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------- terminal scan */

/**
 * Progressive `wanyrix doctor` terminal. Remounted (via key={runId}) to replay:
 * initial state carries the reset, and setState is only ever called from
 * timer callbacks — never synchronously inside the effect body.
 */
function ScanTerminal({
  report,
  onDone,
}: {
  report: DoctorReport
  onDone: (done: boolean, durationMs: number) => void
}) {
  const [revealed, setRevealed] = useState(1) // the $ command line is visible immediately
  const [done, setDone] = useState(false)
  const total = 1 + report.phases.length + 2 // cmd + phases + 2 summary lines

  /* keep the latest callback without restarting the reveal timers (issue #25 pattern) */
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])
  const mountedAt = useRef(0)

  useEffect(() => {
    mountedAt.current = performance.now()
    let count = 1
    let doneTimer: ReturnType<typeof setTimeout> | undefined
    const iv = setInterval(() => {
      count += 1
      setRevealed(count)
      if (count >= total) {
        clearInterval(iv)
        doneTimer = setTimeout(() => {
          setDone(true)
          onDoneRef.current(true, performance.now() - mountedAt.current)
        }, 480)
      }
    }, 380)
    return () => {
      clearInterval(iv)
      if (doneTimer) clearTimeout(doneTimer)
    }
  }, [total])

  const lines = [
    { text: 'wanyrix doctor --profile dev', tone: 'cmd' as const },
    ...report.phases.map((p) => ({ text: `  ✓ ${p.label} — ${p.detail}`, tone: 'ok' as const })),
    {
      text: `Wanyrix found ${report.findings.length} engineering bottlenecks.`,
      tone: 'accent' as const,
    },
    {
      text: `Estimated opportunity: dev ${report.summary.developerBuild} · CI ${report.summary.ciBuild} · disk ${report.summary.diskUsage} (estimated)`,
      tone: 'warn' as const,
    },
  ]

  return (
    <Terminal
      title="wanyrix — zsh"
      lines={lines.slice(0, revealed)}
      step={0}
      running={!done}
    />
  )
}

/* --------------------------------------------------------------- finding */

function FindingCard({
  finding: f,
  index,
  onOpen,
}: {
  finding: Finding
  index: number
  onOpen: (f: Finding) => void
}) {
  const RemIcon = REMEDIATION_META[f.remediationKind].icon
  const realEntities = f.affected.filter((a) => !a.startsWith('+'))
  const extraEntity = f.affected.find((a) => a.startsWith('+'))
  const shownEntities = realEntities.slice(0, 4)
  const moreLabel = extraEntity ?? (realEntities.length > 4 ? `+${realEntities.length - 4} more` : undefined)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.05 }}
    >
      <Card
        role="button"
        tabIndex={0}
        aria-label={`Open detail drawer for ${f.id}`}
        onClick={() => onOpen(f)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(f)
          }
        }}
        className="group cursor-pointer gap-3 border-border/80 p-4 transition-all hover:border-primary/40 hover:shadow-[0_0_0_1px_oklch(0.72_0.17_55/25%),0_8px_24px_-12px_oklch(0_0_0/60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        {/* badges row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground transition-colors group-hover:text-primary">{f.id}</span>
          <SeverityBadge severity={f.severity} />
          <MeasurementBadge status={f.measurementStatus} />
          <ConfidenceBadge level={f.confidenceClass} />
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
        </div>

        <div>
          <h4 className="text-[15px] font-semibold leading-snug">{f.title}</h4>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{f.description}</p>
        </div>

        {/* evidence grid */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {f.evidence.map((ev) => (
            <div key={ev.label} className="rounded-md border border-border/70 bg-background/60 p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{ev.label}</p>
              <p className="mt-0.5 font-mono text-[13px] tabular-nums">{ev.value}</p>
              <p className="mt-0.5 text-[10px] italic text-muted-foreground">src: {ev.source}</p>
            </div>
          ))}
        </div>

        {/* affected entities */}
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Affected entities">
          {shownEntities.map((entity) => (
            <span
              key={entity}
              className="rounded-full border border-border/70 bg-card px-2 py-0.5 font-mono text-[11px] text-foreground/80"
            >
              {entity}
            </span>
          ))}
          {moreLabel && (
            <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-300">
              {moreLabel}
            </span>
          )}
        </div>

        {/* impact */}
        <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-amber-300">
          <Zap className="mt-0.5 size-3.5 shrink-0" />
          {f.impact}
        </p>

        {/* recommendation */}
        <div className="rounded-md border-l-2 border-primary/50 bg-primary/5 p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-primary/90">
            Recommended action
          </p>
          <p className="mt-1 text-[13px] leading-relaxed">{f.recommendation}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
              <RemIcon className="size-3.5" />
              {REMEDIATION_META[f.remediationKind].label}
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            <span className="text-foreground/75">Verification path:</span> {f.verificationPath}
          </p>
        </div>

        {/* footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Progress
              value={f.confidence}
              className="h-1.5 w-24"
              aria-label={`Confidence ${f.confidence}%`}
            />
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {f.confidence}%
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/80">
              detector: {f.detection}
            </span>
          </div>
          <div
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <ExplainDialog
              kind="issue"
              context={JSON.stringify(f)}
              question="Why does this finding matter for our Rust team and how do I verify the fix?"
              label="Explain with AI"
            />
            {f.experimentEligible && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen(f) // routes to the drawer — experiment CTA lives there too
                }}
              >
                Create experiment
              </Button>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ view */

export default function DoctorView({ onNavigate }: ViewProps) {
  const { data: report, isLoading, isError, error, refetch } = useDoctor()
  const { toast } = useToast()
  const activeWs = useWorkspaceStore((s) => s.active)
  const scanTick = useScanStore((s) => s.scanTick)
  const lastTrigger = useScanStore((s) => s.lastTrigger)
  const bumpScan = useScanStore((s) => s.bumpScan)
  const addScanEntry = useScanStore((s) => s.addEntry)
  /* Task 3-b wiring: structured scan-run log (runs[]) recorded at completion */
  const recordScanRun = useRecordScanRun()

  const [mode, setMode] = useState<'human' | 'json'>('human')
  const [selected, setSelected] = useState<Finding | null>(null)

  /* every run goes through the global scan event (issue #37): runId = scanTick.
     The doctor button bumps it with trigger 'manual'; the topbar / ⌘K bump it
     with their own triggers. ScanTerminal remounts on every runId change. */
  const runId = scanTick
  const [doneRun, setDoneRun] = useState(-1)
  const scanDone = doneRun === runId
  const mountedAtTick = useRef(scanTick)

  /* Task 3-b wiring: startedAt = the moment this run's terminal remounted
     (runId change); finishedAt/durationMs arrive at onDone from ScanTerminal. */
  const runStartedAtRef = useRef(Date.now())
  useEffect(() => {
    runStartedAtRef.current = Date.now()
  }, [runId])

  /* findings grouped by section, in curated data order */
  const groups = useMemo(() => {
    if (!report) return []
    const bySection = new Map<FindingSection, Finding[]>()
    for (const f of report.findings) {
      const list = bySection.get(f.section) ?? []
      list.push(f)
      bySection.set(f.section, list)
    }
    const ordered: FindingSection[] = [
      ...SECTION_ORDER.filter((s) => bySection.has(s)),
      ...[...bySection.keys()].filter((s) => !SECTION_ORDER.includes(s)),
    ]
    return ordered.map((section) => ({ section, findings: bySection.get(section)! }))
  }, [report])

  /* recomputed on every runId replay (ScanTerminal builds its own copy) */
  const json = report ? JSON.stringify(report, null, 2) : ''

  /* scan completion → record a history entry (issue #37) + a structured scan
     run (Task 3-b); figures come from the payload. Trigger label: 'manual' for
     the auto-run on view mount, otherwise whatever control bumped the scan
     event that produced this run. */
  const handleScanDone = (done: boolean, durationMs: number) => {
    if (!done) return
    setDoneRun(runId)
    if (report) {
      const trigger = scanTick === mountedAtTick.current ? 'manual' : lastTrigger
      addScanEntry(activeWs, {
        id: `scan-${Date.now()}`,
        workspace: activeWs,
        at: Date.now(),
        durationMs,
        findings: report.findings.length,
        critical: report.findings.filter((f) => f.severity === 'critical').length,
        warning: report.findings.filter((f) => f.severity === 'warning').length,
        info: report.findings.filter((f) => f.severity === 'info').length,
        buildTime: report.buildTime,
        estimatedFrom: report.estimatedRange[0],
        estimatedTo: report.estimatedRange[1],
        trigger,
      })
      recordScanRun({
        startedAt: runStartedAtRef.current,
        finishedAt: Date.now(),
        durationMs,
        findingCount: report.findings.length,
        severityCounts: {
          critical: report.findings.filter((f) => f.severity === 'critical').length,
          warning: report.findings.filter((f) => f.severity === 'warning').length,
          info: report.findings.filter((f) => f.severity === 'info').length,
        },
        trigger,
      })
    }
  }

  const copyJson = () => {
    if (!navigator.clipboard) {
      toast({ title: 'Copy failed', description: 'Clipboard is not available in this context.' })
      return
    }
    navigator.clipboard.writeText(json).then(
      () =>
        toast({
          title: 'Copied — schema versioned (Gate 28)',
          description: 'wanyrix doctor --json output is on your clipboard.',
        }),
      () => toast({ title: 'Copy failed', description: 'Clipboard permission denied.' }),
    )
  }

  /* human-readable markdown report — same facts as --json, Gate 11 equivalence */
  const markdown = report
    ? [
        `# Wanyrix Build Analysis — ${report.workspace}`,
        '',
        `Development build: **${report.buildTime}s** (measured · cargo build --timings)`,
        `Estimated after fixes: **${report.estimatedRange[0]}–${report.estimatedRange[1]}s** (estimated, confidence ${report.confidence}%)`,
        '',
        '## Critical path',
        ...report.criticalPath.map((s) => `- ${s.name}: ${s.seconds}s`),
        '',
        '## Findings',
        ...(report.findings ?? []).flatMap((f) => [
          `### ${f.id} · ${f.severity} · ${f.title} [${f.measurementStatus}]`,
          f.description,
          '',
          '**Evidence**',
          ...f.evidence.map((e) => `- ${e.label}: ${e.value} _(src: ${e.source})_`),
          `- Impact: ${f.impact}`,
          `- Recommendation: ${f.recommendation}`,
          `- Verification: ${f.verificationPath}`,
          '',
        ]),
        '---',
        '_Estimated values — verified only via wanyrix experiment (Gate 21)._',
      ].join('\n')
    : ''

  const copyMarkdown = () => {
    if (!navigator.clipboard) {
      toast({ title: 'Copy failed', description: 'Clipboard is not available in this context.' })
      return
    }
    navigator.clipboard.writeText(markdown).then(
      () =>
        toast({
          title: 'Report copied as markdown',
          description: 'Human/JSON outputs expose equivalent underlying facts (Gate 11).',
        }),
      () => toast({ title: 'Copy failed', description: 'Clipboard permission denied.' }),
    )
  }

  if (isLoading) return <LoadingSkeleton />
  if (isError || !report)
    return (
      <ErrorState
        message={isError ? (error as Error).message : 'empty payload'}
        onRetry={() => refetch()}
      />
    )

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------ 1) header */}
      <SectionHeading
        eyebrow="Build Intelligence"
        title="wanyrix doctor"
        description={`${report.workspace} · ${report.profile} · ${report.toolchain}`}
        actions={
          <>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={mode}
              onValueChange={(v) => v && setMode(v as 'human' | 'json')}
              aria-label="Output mode"
            >
              <ToggleGroupItem value="human">Human</ToggleGroupItem>
              <ToggleGroupItem value="json" className="font-mono">
                --json
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={copyMarkdown}
              disabled={!scanDone}
              title="Copy the human report as markdown (Gate 11)"
            >
              <ClipboardCopy className="size-4" />
              <span className="hidden sm:inline">Copy report (md)</span>
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setMode('human') // a fresh run is watched in the terminal, not in JSON
                bumpScan('manual') // runId = scanTick → ScanTerminal remounts and replays
              }}
              disabled={!scanDone}
              className="gap-2"
            >
              <RefreshCw className={`size-4 ${!scanDone ? 'animate-spin' : ''}`} />
              Run wanyrix doctor
            </Button>
          </>
        }
      />

      {/* ------------------------------------------------ 2) terminal / json */}
      {/* the terminal always runs (so a scan is recorded even while JSON mode is
          on); it is simply hidden while the JSON report is being viewed */}
      <div className={mode === 'json' ? 'hidden' : undefined}>
        <ScanTerminal key={runId} report={report} onDone={handleScanDone} />
      </div>
      {mode === 'json' && (
        <div className="space-y-2">
          <Panel
            title={<span className="font-mono">wanyrix doctor --json</span>}
            subtitle="machine-readable report · schema versioned (Gate 28)"
            actions={
              <Button size="sm" variant="outline" className="gap-1.5" onClick={copyJson}>
                <Copy className="size-3.5" />
                Copy JSON
              </Button>
            }
            bodyClassName="p-0"
          >
            <pre className="scanlines relative max-h-[420px] overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-foreground/90">
              {json}
            </pre>
          </Panel>
          <p className="font-mono text-[11px] text-muted-foreground">
            Gate 11 — exit code 1 = findings detected · exit 0 = clean
          </p>
        </div>
      )}

      {/* ------------------------------------------------ 3) summary strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="gap-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Development build</p>
            <MeasurementBadge status="measured" />
          </div>
          <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
            <CountUp value={report.buildTime} decimals={1} />
            s
          </p>
          <p className="text-[11px] text-muted-foreground">measured · cargo build --timings</p>
        </Card>

        <Card className="gap-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Estimated after fixes</p>
            <MeasurementBadge status="estimated" />
          </div>
          <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
            {report.estimatedRange[0]}–{report.estimatedRange[1]}s
          </p>
          <div className="flex items-center gap-2">
            <ConfidenceBadge level={confidenceClass(report.confidence)} />
            <Progress
              value={report.confidence}
              className="h-1.5 flex-1"
              aria-label={`Confidence ${report.confidence}%`}
            />
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {report.confidence}%
            </span>
          </div>
        </Card>

        <Card className="gap-2 p-4">
          <p className="text-xs font-medium text-muted-foreground">Critical-path explanation</p>
          <p className="text-[13px] leading-relaxed">
            {report.criticalPathExplanation ?? 'Open the critical-path chart to inspect what the build time is made of.'}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => onNavigate?.('experiments')}
          >
            See verified experiment
          </Button>
        </Card>
      </div>

      {/* ------------------------------------------------ 4) critical path */}
      <ScanHistoryPanel currentBuildTime={report.buildTime} />

      {/* ------------------------------------------------ 5) critical path chart */}
      <Panel title="Critical path" subtitle={`what the ${report.buildTime}s is made of`}>
        <div className="h-[264px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={report.criticalPath}
              margin={{ top: 4, right: 24, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 6%)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: 'oklch(0.65 0.01 60)', fontFamily: MONO }}
                axisLine={false}
                tickLine={false}
                unit="s"
              />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={{ fontSize: 10, fill: 'oklch(0.8 0.01 60)', fontFamily: MONO }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: 'oklch(0.85 0.01 60)', fontFamily: MONO, marginBottom: 4 }}
                itemStyle={{ fontFamily: MONO, fontSize: '11px', padding: 0 }}
                formatter={(value) => [`${value}s`, 'compile time']}
                cursor={{ fill: 'oklch(1 0 0 / 4%)' }}
              />
              <Bar dataKey="seconds" radius={[0, 4, 4, 0]} barSize={16}>
                {report.criticalPath.map((seg) => (
                  <Cell key={seg.name} fill={PATH_KIND_COLOR[seg.kind]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {report.criticalPathCaption ?? 'Linking includes codegen · figures from cargo build --timings'}
        </p>
      </Panel>

      {/* ------------------------------------------------ 4b) sccache simulator */}
      <SccacheSimulator report={report} onNavigate={() => onNavigate?.('experiments')} />

      {/* ------------------------------------------------ 5) findings */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Findings</h2>
        <div className="flex flex-wrap items-center gap-2" aria-label="Severity legend">
          <SeverityBadge severity="critical" />
          <SeverityBadge severity="warning" />
          <SeverityBadge severity="info" />
        </div>
      </div>

      {groups.map((group) => (
        <section key={group.section} className="space-y-3" aria-label={`${group.section} findings`}>
          <div className="flex items-center gap-2.5">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {group.section}
            </h3>
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              {group.findings.length}
            </Badge>
            <div className="h-px flex-1 bg-border/60" />
          </div>
          {group.findings.map((f, i) => (
            <FindingCard key={f.id} finding={f} index={i} onOpen={setSelected} />
          ))}
        </section>
      ))}

      {/* finding drill-down drawer (issue #25) */}
      <FindingSheet finding={selected} onOpenChange={(o) => !o && setSelected(null)} onNavigate={onNavigate} />

      {/* ------------------------------------------------ 6) bottom estimates */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Developer build', value: report.summary.developerBuild },
          { label: 'CI build', value: report.summary.ciBuild },
          { label: 'Disk usage', value: report.summary.diskUsage },
        ].map((item) => (
          <Card key={item.label} className="flex-row items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{item.value}</p>
            </div>
            <MeasurementBadge status="estimated" />
          </Card>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        No optimization claim is presented as measured until an experiment verifies it (Gate 21).
      </p>
    </div>
  )
}
