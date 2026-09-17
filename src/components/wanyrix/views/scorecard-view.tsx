'use client'

import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  Download,
  FileJson,
  FileText,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { GateStatus, GatesPayload } from '@/lib/wanyrix/types'
import { useGates } from '@/lib/wanyrix/hooks'
import { useToast } from '@/hooks/use-toast'
import { Panel, SectionHeading } from '../shared'
import { ExplainDialog } from '../explain-dialog'
import type { ViewProps } from '../view-types'

/* ------------------------------------------------------------------ styles */

const STATUS_BADGE: Record<GateStatus, string> = {
  pass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  conditional: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  fail: 'border-red-500/30 bg-red-500/10 text-red-300',
  pending: 'border-border bg-muted/40 text-muted-foreground',
}

function StatusBadge({ status }: { status: GateStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${STATUS_BADGE[status]}`}
    >
      {status}
    </span>
  )
}

/* ------------------------------------------------------------------ filters */

type GateFilter = 'all' | 'blocking' | 'conditional'

const FILTERS: { id: GateFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'blocking', label: 'Blocking' },
  { id: 'conditional', label: 'Conditional' },
]

/* ---------------------------------------------------------- exit-code table */

const EXIT_CODES: [string, string][] = [
  ['0', 'success / no actionable failure'],
  ['1', 'findings detected'],
  ['2', 'invalid usage / configuration'],
  ['3', 'runtime / infrastructure failure'],
]

/* --------------------------------------------------------------- skeleton */

function LoadingState() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-36 rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[520px] lg:col-span-2" />
        <div className="space-y-4">
          <Skeleton className="h-[430px]" />
          <Skeleton className="h-48" />
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- export */

const RELEASE = '0.4.2'

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function ExportMenu({ data }: { data: GatesPayload }) {
  const { toast } = useToast()

  const exportJson = () => {
    const payload = {
      schema: 'wanyrix.release-scorecard/v1',
      generatedAt: new Date().toISOString(),
      release: RELEASE,
      verdict: data.verdict,
      rationale: data.rationale,
      gates: data.gates,
      blockingConditions: data.blockingConditions,
    }
    downloadBlob(
      `wanyrix-scorecard-${RELEASE}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    )
    toast({
      title: 'Scorecard exported as JSON',
      description: 'wanyrix.release-scorecard/v1 — versioned schema (Gate 28).',
    })
  }

  const exportMarkdown = () => {
    const md = [
      `# Wanyrix Release Scorecard — ${RELEASE}`,
      '',
      `**Verdict: ${data.verdict}**`,
      '',
      data.rationale,
      '',
      '## Gates',
      '',
      '| # | Gate | Target | Measured | Status | Blocking |',
      '|---|------|--------|----------|--------|----------|',
      ...data.gates.map(
        (g) =>
          `| ${g.id} | ${g.name} | ${g.target} | ${g.measured} | ${g.status} | ${g.blocking ? '⚠️ blocking' : '—'} |`,
      ),
      '',
      '## Release-blocking conditions',
      ...(data.blockingConditions ?? []).map(
        (c) => `- [${c.clear ? 'x' : ' '}] ${c.condition} — ${c.note}`,
      ),
      '',
      '---',
      '_Machine-readable contract: wanyrix doctor --json (Gate 11) · estimates are never presented as measurements (Gate 21)._',
    ].join('\n')
    downloadBlob(`wanyrix-scorecard-${RELEASE}.md`, md, 'text/markdown')
    toast({
      title: 'Scorecard exported as markdown',
      description: 'Verdict, gates and blocking conditions included.',
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Download className="size-3.5" aria-hidden />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          release scorecard
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={exportJson} className="gap-2">
          <FileJson className="size-4 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium">JSON</p>
            <p className="font-mono text-[10px] text-muted-foreground">wanyrix.release-scorecard/v1</p>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportMarkdown} className="gap-2">
          <FileText className="size-4 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium">Markdown</p>
            <p className="font-mono text-[10px] text-muted-foreground">verdict · gates · blockers</p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ------------------------------------------------------------------- view */

export default function ScorecardView(_: ViewProps) {
  const { data, isLoading, isError, refetch } = useGates()
  const [filter, setFilter] = useState<GateFilter>('all')

  const stats = useMemo(() => {
    const gates = data?.gates ?? []
    return {
      pass: gates.filter((g) => g.status === 'pass').length,
      conditional: gates.filter((g) => g.status === 'conditional').length,
      fail: gates.filter((g) => g.status === 'fail').length,
      blocking: gates.filter((g) => g.blocking).length,
    }
  }, [data])

  const visibleGates = useMemo(() => {
    const gates = data?.gates ?? []
    if (filter === 'blocking') return gates.filter((g) => g.blocking)
    if (filter === 'conditional') return gates.filter((g) => g.status === 'conditional')
    return gates
  }, [data, filter])

  if (isLoading) {
    return (
      <div className="space-y-5">
        <SectionHeading eyebrow="Release Governance" title="Release scorecard" />
        <LoadingState />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="space-y-5">
        <SectionHeading eyebrow="Release Governance" title="Release scorecard" />
        <Panel title="Scorecard unavailable">
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-red-300">
              Failed to load gates from <span className="font-mono">/api/wanyrix/gates</span>.
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()} className="gap-1.5">
              <RotateCcw className="size-3.5" />
              Retry
            </Button>
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Release Governance"
        title="Release scorecard"
        actions={data ? <ExportMenu data={data} /> : undefined}
      />

      {/* ------------------------------------------------ verdict banner */}
      <div className="rounded-xl bg-gradient-to-r from-amber-500/50 via-primary/40 to-amber-500/50 p-px">
        <div className="rounded-[calc(0.625rem-1px)] bg-card p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3.5">
              <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10">
                <ShieldCheck className="size-5 text-amber-300" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  release verdict
                </p>
                <p className="text-glow mt-0.5 font-mono text-2xl font-semibold tracking-tight text-amber-300 sm:text-[28px]">
                  {data.verdict}
                </p>
              </div>
            </div>
            <p className="font-mono text-xs text-muted-foreground">2026-09-17 · release 0.4.2</p>
          </div>

          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{data.rationale}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-emerald-300">
              <CheckCircle2 className="size-3" aria-hidden />
              {stats.pass} PASS
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-amber-300">
              <ShieldAlert className="size-3" aria-hidden />
              {stats.conditional} CONDITIONAL
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-red-300">
              <ShieldAlert className="size-3" aria-hidden />
              {stats.fail} FAIL
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {stats.blocking} of {data.gates.length} gates are release-blocking
            </span>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ body grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* gates table */}
        <div className="lg:col-span-2">
          <Panel
            title="MVP acceptance gates"
            subtitle="consolidated 20-gate scorecard — no vanity aggregate score"
            bodyClassName="p-0"
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3">
              {FILTERS.map((f) => {
                const active = filter === f.id
                return (
                  <Button
                    key={f.id}
                    size="sm"
                    variant="ghost"
                    aria-pressed={active}
                    onClick={() => setFilter(f.id)}
                    className={
                      active
                        ? 'h-7 gap-1.5 border border-primary/30 bg-primary/10 px-2.5 text-xs text-primary'
                        : 'h-7 gap-1.5 border border-transparent px-2.5 text-xs text-muted-foreground hover:text-foreground'
                    }
                  >
                    {f.label}
                    <span className="font-mono text-[10px] opacity-70">
                      {f.id === 'all'
                        ? data.gates.length
                        : f.id === 'blocking'
                          ? stats.blocking
                          : stats.conditional}
                    </span>
                  </Button>
                )
              })}
            </div>

            <div className="px-1 pb-1">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10 pl-4 font-mono text-[10px] text-muted-foreground">#</TableHead>
                    <TableHead className="min-w-[180px] text-[10px] uppercase tracking-wide text-muted-foreground">
                      Gate
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Target</TableHead>
                    <TableHead className="min-w-[150px] text-[10px] uppercase tracking-wide text-muted-foreground">
                      Measured
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Blocking</TableHead>
                    <TableHead className="min-w-[140px] text-[10px] uppercase tracking-wide text-muted-foreground">
                      Evidence
                    </TableHead>
                    <TableHead className="w-16 pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleGates.map((gate) => (
                    <TableRow key={gate.id}>
                      <TableCell className="pl-4 font-mono text-[11px] text-muted-foreground">
                        {String(gate.id).padStart(2, '0')}
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <p className="text-[12.5px] font-medium leading-snug">{gate.name}</p>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{gate.objective}</p>
                      </TableCell>
                      <TableCell className="max-w-[150px] font-mono text-[11px] leading-snug text-muted-foreground">
                        {gate.target}
                      </TableCell>
                      <TableCell className="max-w-[170px] font-mono text-[11px] leading-snug">{gate.measured}</TableCell>
                      <TableCell>
                        <StatusBadge status={gate.status} />
                      </TableCell>
                      <TableCell>
                        {gate.blocking ? (
                          <span title="release-blocking" className="inline-flex">
                            <ShieldAlert className="size-4 text-amber-300" aria-label="release-blocking" />
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{gate.evidence}</p>
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <ExplainDialog
                          kind="gate"
                          context={JSON.stringify(gate)}
                          question="What does this gate require and what would move it to PASS?"
                          label="Why?"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {visibleGates.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">No gates match this filter.</p>
              )}
            </div>
          </Panel>
        </div>

        {/* right column */}
        <div className="space-y-4">
          <Panel
            title="Release-blocking conditions"
            subtitle={`MUST NOT ship if any fail — ${data.blockingConditions.length} tracked`}
            bodyClassName="p-0"
          >
            <ScrollArea className="max-h-[430px]">
              <ul className="space-y-2.5 p-4">
                {data.blockingConditions.map((c) => (
                  <li key={c.condition} className="flex items-start gap-2.5">
                    {c.clear ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-label="clear" />
                    ) : (
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-red-400" aria-label="not clear" />
                    )}
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium leading-snug">{c.condition}</p>
                      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{c.note}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </Panel>

          <Panel title="CLI contract (Gate 11)" subtitle="stable, machine-readable, versioned">
            <div className="space-y-1">
              {EXIT_CODES.map(([code, meaning]) => (
                <div key={code} className="flex items-center gap-2.5 rounded-md px-1 py-1">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded border border-border/70 bg-muted/40 font-mono text-[11px] text-primary">
                    {code}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">{meaning}</span>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <pre className="overflow-x-auto rounded-lg border border-border/70 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-foreground/85">
                {'$ wanyrix doctor --json | jq \'.findings[].id\''}
              </pre>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Terminal className="size-3.5 shrink-0 text-primary/80" aria-hidden />
                100% commands support --json · versioned schemas
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
