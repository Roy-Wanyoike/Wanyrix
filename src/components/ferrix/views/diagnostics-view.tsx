'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  Braces,
  Check,
  GitBranch,
  Info,
  RotateCw,
  Scale,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { useDiagnostics } from '@/lib/ferrix/hooks'
import type { AsyncSegment, AsyncTask, BorrowScenario, DiagnosticsPayload } from '@/lib/ferrix/types'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { ExplainDialog } from '../explain-dialog'
import { useWorkspaceStore } from '@/lib/ferrix/workspace-store'
import { CountUp, Panel, SectionHeading } from '../shared'
import type { ViewProps } from '../view-types'

/* The E0502 conflict lives on line 5 (0-based index 4) of the fixture. */
const ERRONEOUS_LINE_INDEX = 4
/** Timeline maps main() lines 1..7 onto a 0..100% scale. */
const TIMELINE_LINES = 7

const linePos = (start: number, end: number) => ({
  left: `${((start - 1) / (TIMELINE_LINES - 1)) * 100}%`,
  width: `${((end - start + 1) / (TIMELINE_LINES - 1)) * 100}%`,
})

/* ------------------------------------------------------------------ borrow */

function BorrowCheckerTab({ borrow }: { borrow: BorrowScenario }) {
  const [stepId, setStepId] = useState(1)
  const active = borrow.steps.find((s) => s.id === stepId) ?? borrow.steps[0]
  const conflictActive = active.id === 2 || active.id === 4
  const sharedLifetime = (borrow.steps.find((s) => s.id === 1) ?? borrow.steps[0]).lifetime
  const conflictLifetime = (borrow.steps.find((s) => s.id === 2) ?? borrow.steps[0]).lifetime
  const mutableLifetime = (borrow.steps.find((s) => s.id === 4) ?? borrow.steps[0]).lifetime

  return (
    <TabsContent value="borrow" className="mt-4 space-y-4">
      <div className="grid gap-4 lg:grid-cols-5">
        {/* error + annotated source */}
        <Panel
          className="lg:col-span-3"
          title={
            <span className="block truncate font-mono text-xs font-medium text-red-300" title={borrow.error}>
              {borrow.error}
            </span>
          }
          subtitle="deterministic — soundness guarantee, not style"
        >
          <div className="overflow-x-auto rounded-lg border border-border/70 bg-black/30 p-3">
            <pre className="font-mono text-[12.5px] leading-6">
              {borrow.code.map((line, i) => {
                const isActiveLine = i === active.line - 1
                const isErroneous = i === ERRONEOUS_LINE_INDEX
                const errActive = isErroneous && conflictActive
                return (
                  <div
                    key={i}
                    className={cn(
                      '-mx-1 flex rounded-sm border-l-2 px-2 transition-colors duration-300',
                      isActiveLine && !errActive && 'border-primary bg-primary/12',
                      errActive && 'border-red-400 bg-red-500/10',
                      !isActiveLine && 'border-transparent',
                      !isActiveLine && isErroneous && conflictActive && 'bg-red-500/10',
                    )}
                  >
                    <span
                      className={cn(
                        'w-8 shrink-0 select-none pr-2 text-right font-mono text-[10px] tabular-nums leading-6',
                        errActive ? 'text-red-400' : isActiveLine ? 'text-primary' : 'text-muted-foreground/60',
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className={cn('whitespace-pre pl-1 leading-6', isErroneous ? 'text-red-300' : 'text-foreground/85')}>
                      {line}
                    </span>
                  </div>
                )
              })}
            </pre>
          </div>
        </Panel>

        {/* checker execution steps */}
        <Panel className="lg:col-span-2" title="Execution of the checker" subtitle="step through how rustc reaches E0502">
          <div className="space-y-2">
            {borrow.steps.map((step) => {
              const isActive = step.id === active.id
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setStepId(step.id)}
                  aria-pressed={isActive}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                    isActive
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border/70 hover:border-border hover:bg-white/[0.03]',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]',
                      isActive
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-white/5 text-muted-foreground',
                    )}
                  >
                    {step.id}
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate text-[13px] font-medium', isActive ? 'text-foreground' : 'text-muted-foreground')}>
                    {step.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">L{step.line}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-3 min-h-[5.5rem] rounded-md border border-border/60 bg-white/[0.02] p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-primary/80">
              step {active.id} · line {active.line}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{active.detail}</p>
          </div>
        </Panel>
      </div>

      {/* lifetime timeline */}
      <Panel title="Lifetime timeline" subtitle="shared borrow must outlive the mutable borrow">
        <div className="relative">
          {/* segment boundary gridlines */}
          <div className="pointer-events-none absolute inset-x-0 top-6 bottom-0 hidden sm:block">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="absolute inset-y-0 w-px bg-white/[0.04]" style={{ left: `${(i / (TIMELINE_LINES - 1)) * 100}%` }} />
            ))}
          </div>

          {/* tick labels centered over each line segment */}
          <div className="relative h-4">
            {borrow.timelineTicks.map((tick, i) => (
              <span
                key={tick}
                className="absolute -translate-x-1/2 font-mono text-[10px] text-muted-foreground"
                style={{ left: `${((i + 0.5) / (TIMELINE_LINES - 1)) * 100}%` }}
              >
                {tick}
              </span>
            ))}
          </div>

          <div className="relative mt-2 space-y-2">
            {/* shared borrow — teal */}
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-right font-mono text-[10px] text-muted-foreground sm:w-28">
                {sharedLifetime.label}
              </span>
              <div className="relative h-6 flex-1 rounded bg-white/[0.03]">
                <motion.div
                  className="absolute inset-y-0 origin-left rounded-[3px] bg-chart-3/70"
                  style={linePos(sharedLifetime.start, sharedLifetime.end)}
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{
                    scaleX: 1,
                    opacity: active.id === 1 || active.id === 3 ? 1 : 0.35,
                  }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>
            </div>

            {/* mutable borrow + conflict marker — red bar with amber sliver */}
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-right font-mono text-[10px] text-muted-foreground sm:w-28">
                {conflictLifetime.label}
              </span>
              <div className="relative h-6 flex-1 rounded bg-white/[0.03]">
                <motion.div
                  className="absolute inset-y-0 origin-left rounded-[3px] bg-red-500/60"
                  style={linePos(conflictLifetime.start, conflictLifetime.end)}
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: conflictActive ? 1 : 0.4 }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
                <motion.div
                  className="absolute bottom-0 h-1 origin-left rounded-b-[3px] bg-amber-400/90"
                  style={linePos(mutableLifetime.start, mutableLifetime.end)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: active.id === 4 ? 1 : 0.15 }}
                  transition={{ duration: 0.35 }}
                />
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 border-t border-border/60 pt-3 text-[13px] leading-relaxed text-muted-foreground">
          {borrow.narrative}
        </p>
      </Panel>

      {/* solutions */}
      <Panel title="Possible solutions" subtitle="each preserves the aliasing guarantee — pick the cheapest correct fix">
        <Accordion type="single" collapsible defaultValue="sol-0">
          {borrow.solutions.map((sol, i) => (
            <AccordionItem key={sol.title} value={`sol-${i}`}>
              <AccordionTrigger className="py-3 text-[13px]">{sol.title}</AccordionTrigger>
              <AccordionContent className="pb-4">
                <pre className="overflow-x-auto rounded-md border border-border/70 bg-black/30 p-3 font-mono text-xs leading-5 text-foreground/85">
                  {sol.code}
                </pre>
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                  <Scale className="mt-0.5 size-3 shrink-0 text-amber-300/80" />
                  <span>
                    <span className="text-muted-foreground/70">Trade-off:</span> {sol.tradeOff}
                  </span>
                </p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Panel>

      {/* footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card p-4">
        <ExplainDialog
          kind="borrow"
          context={JSON.stringify(borrow)}
          question="Explain why Rust rejects this program and teach me the underlying ownership concept"
          label="Explain the concept"
          size="lg"
        />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0 text-emerald-300" />
          Ferrix explains concepts — it never silently rewrites code (Gate 19).
        </p>
      </div>
    </TabsContent>
  )
}

/* ------------------------------------------------------------------- async */

const SEGMENT_COLOR: Record<AsyncSegment['kind'], string> = {
  compute: 'bg-zinc-400/60',
  db: 'bg-chart-3/70',
  network: 'bg-amber-400/70',
  background: 'bg-violet-400/70',
  blocked: 'bg-red-400/70',
}

function TaskStateBadge({ state }: { state: AsyncTask['state'] }) {
  const base = 'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide'
  switch (state) {
    case 'running':
      return (
        <span className={cn(base, 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300')}>
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
          running
        </span>
      )
    case 'awaited':
      return <span className={cn(base, 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300')}>await</span>
    case 'resumed':
      return <span className={cn(base, 'border-amber-500/25 bg-amber-500/10 text-amber-300')}>resumed</span>
    case 'done':
      return (
        <span className={cn(base, 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400')}>
          <Check className="size-3" />
          done
        </span>
      )
    case 'blocked':
      return (
        <span className={cn(base, 'border-red-500/25 bg-red-500/10 text-red-300')}>
          <TriangleAlert className="size-3" />
          blocked
        </span>
      )
  }
}

function TaskCard({ task, onNavigate }: { task: AsyncTask; onNavigate?: ViewProps['onNavigate'] }) {
  const blocked = task.state === 'blocked'
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        blocked ? 'border-red-500/40 bg-red-500/[0.04]' : 'border-border/80 bg-white/[0.02]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[11px] text-primary/80">{task.id}</span>
          <span className="truncate text-[13px] font-medium">{task.label}</span>
        </div>
        <TaskStateBadge state={task.state} />
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{task.detail}</p>
      {blocked && onNavigate && (
        <button
          type="button"
          onClick={() => onNavigate?.('doctor')}
          className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] text-primary/90 hover:text-primary hover:underline"
        >
          view finding FER-ASY-012 →
        </button>
      )}
    </div>
  )
}

function AsyncFlowTab({ request, onNavigate }: { request: DiagnosticsPayload['request']; onNavigate?: ViewProps['onNavigate'] }) {
  const children = request.tasks.filter((t) => t.parent === 'T1')
  const root = request.tasks.find((t) => !t.parent)
  const standalone = request.tasks.filter((t) => !t.parent && t.id !== root?.id)

  return (
    <TabsContent value="request" className="mt-4 space-y-4">
      {/* header */}
      <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-sm text-muted-foreground">#{request.id}</span>
            <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-emerald-300">
              {request.method}
            </span>
            <span className="font-mono text-sm text-foreground/90">{request.path}</span>
          </div>
          <div className="flex items-baseline gap-2 sm:ml-auto">
            <span className="font-mono text-3xl font-semibold tracking-tight text-foreground">
              <CountUp value={request.totalMs} decimals={1} suffix=" ms" />
            </span>
            <span className="text-xs text-muted-foreground">total</span>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
          {request.warnings.map((w, i) => (
            <p
              key={w}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug',
                i === 0
                  ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
                  : 'border-red-500/25 bg-red-500/10 text-red-300',
              )}
            >
              <TriangleAlert className="size-3.5 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      </div>

      {/* waterfall */}
      <Panel title="Request waterfall" subtitle="reconstructed from tracing spans — spans/events, not logs">
        <div className="space-y-2">
          {request.segments.map((seg, i) => {
            const leftPct = (seg.startMs / request.totalMs) * 100
            const widthPct = (seg.durationMs / request.totalMs) * 100
            const concurrent = seg.id === 'db' || seg.id === 'prov'
            const note = seg.id === 'bg' ? seg.note : concurrent ? 'runs concurrently' : undefined
            return (
              <div key={seg.id} className="flex items-center gap-3">
                <div className="w-32 shrink-0 sm:w-40">
                  <p className="truncate text-xs font-medium">{seg.label}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">{seg.span}</p>
                  {note && (
                    <p className={cn('flex items-center gap-1 truncate text-[10px]', concurrent ? 'text-amber-300/80' : 'text-muted-foreground/70')}>
                      {concurrent && <GitBranch className="size-2.5 shrink-0" />}
                      {note}
                    </p>
                  )}
                </div>
                <div className="relative h-7 min-w-0 flex-1 rounded bg-white/5">
                  {seg.id === 'db' && (
                    <div
                      aria-hidden
                      className="absolute z-10 w-px border-l border-dashed border-amber-300/50"
                      style={{ left: `${leftPct}%`, bottom: '-0.5rem', height: 'calc(100% + 0.5rem)' }}
                    />
                  )}
                  {seg.id === 'prov' && (
                    <div
                      aria-hidden
                      className="absolute z-10 w-px border-l border-dashed border-amber-300/50"
                      style={{ left: `${leftPct}%`, top: '-0.5rem', height: 'calc(100% + 0.5rem)' }}
                    />
                  )}
                  <motion.div
                    className={cn('absolute inset-y-0.5 origin-left rounded-[3px]', SEGMENT_COLOR[seg.kind])}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.5, delay: i * 0.08, ease: 'easeOut' }}
                  >
                    {seg.id === 'prov' && (
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 rounded-sm bg-black/30 px-1.5 py-0.5 font-mono text-[9px] text-amber-50">
                        {Math.round((seg.durationMs / request.totalMs) * 100)}% of latency
                      </span>
                    )}
                  </motion.div>
                </div>
                <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                  +{seg.durationMs}ms
                </span>
              </div>
            )
          })}
        </div>
      </Panel>

      {/* task graph */}
      <Panel title="Task graph" subtitle="logical async execution path — not thread execution">
        {root && <TaskCard task={root} />}
        <div aria-hidden className="mx-auto hidden h-4 w-px bg-border/70 sm:block" />
        <div className="relative pt-4 sm:pt-0">
          {/* tree connectors (desktop) */}
          <div aria-hidden className="absolute inset-x-0 top-0 hidden sm:block">
            <div className="absolute left-[16.666%] right-[16.666%] h-px bg-border/70" />
            <div className="absolute left-[16.666%] h-4 w-px bg-border/70" />
            <div className="absolute left-1/2 h-4 w-px bg-border/70" />
            <div className="absolute right-[16.666%] h-4 w-px bg-border/70" />
          </div>
          <div className="grid gap-3 pt-4 sm:grid-cols-3">
            {children.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        </div>
        {standalone.map((t) => (
          <div key={t.id} className="mt-4">
            <TaskCard task={t} onNavigate={onNavigate} />
          </div>
        ))}
      </Panel>

      {/* footer */}
      <div className="flex justify-end">
        <ExplainDialog
          kind="general"
          context={JSON.stringify(request)}
          question="Walk me through what happens during this request and what to optimize first"
          label="Explain with AI"
        />
      </div>
    </TabsContent>
  )
}

/* -------------------------------------------------------------------- view */

function DiagnosticsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-72 lg:col-span-3" />
        <Skeleton className="h-72 lg:col-span-2" />
      </div>
      <Skeleton className="h-44" />
      <Skeleton className="h-56" />
    </div>
  )
}

export default function DiagnosticsView({ onNavigate }: ViewProps) {
  const activeWorkspace = useWorkspaceStore((s) => s.active)
  const { data, isPending, isError, error, refetch } = useDiagnostics()

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Debugging Intelligence"
        title="Diagnostics"
        description="Explain the concept, not just generate a fix — compile-time and runtime understanding side by side."
      />

      {activeWorkspace !== 'helios-platform' && (
        <p className="flex items-start gap-1.5 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-[11.5px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary/70" aria-hidden />
          Diagnostic scenarios are indexed for{' '}
          <span className="font-mono text-foreground/85">helios-platform</span> — findings referenced here (e.g.
          FER-ASY-012) belong to that workspace.
        </p>
      )}

      {isPending && <DiagnosticsSkeleton />}

      {isError && (
        <Panel title="Diagnostics unavailable">
          <div className="flex flex-col items-start gap-3">
            <p className="font-mono text-xs text-red-300">{(error as Error).message}</p>
            <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => refetch()}>
              <RotateCw className="size-3.5" />
              Retry
            </Button>
          </div>
        </Panel>
      )}

      {data && (
        <Tabs defaultValue="borrow">
          <TabsList>
            <TabsTrigger value="borrow">
              <Braces className="size-3.5" />
              Borrow Checker Explainer
            </TabsTrigger>
            <TabsTrigger value="request">
              <Activity className="size-3.5" />
              Async Flow Inspector
            </TabsTrigger>
          </TabsList>
          <BorrowCheckerTab borrow={data.borrow} />
          <AsyncFlowTab request={data.request} onNavigate={onNavigate} />
        </Tabs>
      )}
    </div>
  )
}
