'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowDown, ArrowRight, Lightbulb, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { useGraph, useImpact } from '@/lib/ferrix/hooks'
import type { AddDepImpact, BlastEntry, EditFileImpact, ImpactPayload, SplitImpact } from '@/lib/ferrix/types'
import { cn } from '@/lib/utils'
import { ExplainDialog } from '../explain-dialog'
import { CountUp, MeasurementBadge, Panel, SectionHeading } from '../shared'
import type { ViewProps } from '../view-types'

/* ----------------------------------------------------------------- helpers */

type Mode = 'add-dep' | 'edit-file' | 'split-crate'

/** Minimal structural view of a TanStack Query result — keeps props simple. */
interface QueryLike<T> {
  data: T | undefined
  isPending: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
}

// the add-dep catalog is served per workspace via the graph payload (issue #34)

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
}

function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3.5">
      <p className="text-xs text-red-300">Failed to load impact estimate — {message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

function TilesSkeleton({ count = 7 }: { count?: number }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className="h-[74px]" />
        ))}
      </div>
      <Skeleton className="h-28" />
    </div>
  )
}

function ImpactTile({
  label,
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  cost = false,
}: {
  label: string
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
  cost?: boolean
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-mono text-lg font-semibold', cost ? 'text-red-300' : 'text-foreground')}>
        <CountUp value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
      </p>
    </div>
  )
}

function ChainStepper({ items }: { items: { label: string; note?: string }[] }) {
  return (
    <ol className="relative ml-1.5 space-y-4 border-l border-border/60 pl-5">
      {items.map((c, i) => (
        <li key={`${c.label}-${i}`} className="relative">
          <span
            className={cn(
              'absolute -left-[25.5px] top-0.5 size-2.5 rounded-full border-2 border-background',
              i === 0 ? 'bg-primary' : 'bg-primary/50',
            )}
          />
          <p className="text-sm font-medium leading-tight">{c.label}</p>
          {c.note && <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{c.note}</p>}
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------ add-dep tab */

function CatalogCard({
  id,
  version,
  active,
  onSelect,
}: {
  id: string
  version: string
  active: boolean
  onSelect: () => void
}) {
  const query = useImpact('add-dep', id)
  const d = query.data && query.data.kind === 'add-dep' ? query.data : undefined

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition-colors',
        active ? 'border-primary/60 bg-primary/10' : 'border-border/70 bg-card hover:border-primary/30',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs font-semibold">{id}</span>
        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
          v{version}
        </Badge>
      </div>
      <div className="mt-2 flex items-center gap-3 font-mono text-[11px]">
        {d ? (
          <>
            <span className="text-muted-foreground">{d.cratesAdded} crates</span>
            <span className="text-red-300">+{d.ciDelta}s CI</span>
          </>
        ) : (
          <span className="animate-pulse text-muted-foreground">loading…</span>
        )}
      </div>
    </button>
  )
}

function AddDepReport({ query }: { query: QueryLike<ImpactPayload> }) {
  const [pending, setPending] = useState<string | null>(null)
  const { toast } = useToast()
  const d = query.data && query.data.kind === 'add-dep' ? (query.data as AddDepImpact) : undefined

  if (query.isPending || (query.data === undefined && !query.isError)) {
    return (
      <Panel title="Dependency impact">
        <TilesSkeleton />
      </Panel>
    )
  }

  if (!d) {
    return (
      <Panel title="Dependency impact">
        <QueryError message={query.error?.message ?? 'unknown error'} onRetry={() => query.refetch()} />
      </Panel>
    )
  }

  const tiles: {
    label: string
    value: number
    decimals?: number
    prefix?: string
    suffix?: string
    cost?: boolean
  }[] = [
    { label: 'crates added', value: d.cratesAdded },
    { label: 'proc-macros added', value: d.procMacrosAdded },
    { label: 'target size', value: d.targetMB, decimals: 1, suffix: ' MB' },
    { label: 'transitive deps', value: d.transitiveDeps },
    { label: 'clean build', value: d.cleanDelta, decimals: 1, prefix: '+', suffix: 's', cost: true },
    { label: 'incremental', value: d.incrementalDelta, decimals: 1, prefix: '+', suffix: 's', cost: true },
    { label: 'CI', value: d.ciDelta, prefix: '+', suffix: 's', cost: true },
  ]

  return (
    <Panel
      title={`Dependency impact — ${d.crate} ${d.version}`}
      subtitle="what enters your tree if you add this crate"
      actions={<MeasurementBadge status={d.measurementStatus} />}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {tiles.map((t) => (
            <ImpactTile key={t.label} {...t} />
          ))}
        </div>

        <section>
          <SectionLabel>Cascading rebuild chain</SectionLabel>
          <div className="mt-3">
            <ChainStepper items={d.chain} />
          </div>
        </section>

        <section>
          <SectionLabel>Security &amp; supply chain</SectionLabel>
          <ul className="mt-2.5 space-y-1.5">
            {d.security.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                {s.level === 'warn' ? (
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                ) : (
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal-300" />
                )}
                <span className={s.level === 'warn' ? 'text-amber-200/90' : 'text-muted-foreground'}>
                  {s.label}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionLabel>Suggestions</SectionLabel>
          <ol className="mt-2.5 space-y-2">
            {d.suggestions.map((s, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
              >
                <p className="text-xs leading-snug">
                  <span className="mr-2 font-mono text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                  {s}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-[11px]"
                  onClick={() => setPending(s)}
                >
                  Apply suggestion
                </Button>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Queue a reviewable diff?</DialogTitle>
            <DialogDescription>
              Ferrix never modifies your repository silently. A reviewable diff will be proposed (Gate 19).
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
            {pending}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                toast({ title: 'Diff queued for review (demo)', description: pending ?? undefined })
                setPending(null)
              }}
            >
              Queue as diff
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

/* ---------------------------------------------------------- edit-file tab */

function EditFileReport({
  query,
  onNavigate,
}: {
  query: QueryLike<ImpactPayload>
  onNavigate?: ViewProps['onNavigate']
}) {
  const d = query.data && query.data.kind === 'edit-file' ? (query.data as EditFileImpact) : undefined

  if (query.isPending || (query.data === undefined && !query.isError)) {
    return (
      <Panel title="File impact">
        <TilesSkeleton count={2} />
      </Panel>
    )
  }

  if (!d) {
    return (
      <Panel title="File impact">
        <QueryError message={query.error?.message ?? 'unknown error'} onRetry={() => query.refetch()} />
      </Panel>
    )
  }

  return (
    <Panel
      title="File impact"
      subtitle={d.file}
      actions={<MeasurementBadge status={d.measurementStatus} />}
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3.5">
          <p className="font-mono text-4xl font-semibold text-red-300">
            <CountUp value={d.affectedWorkspace} />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            workspace crates re-invalidate when <span className="font-mono text-[11px] text-foreground/80">{d.file}</span> changes
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <ImpactTile label="incremental rebuild" value={d.incrementalDelta} decimals={1} prefix="+" suffix="s" cost />
          <ImpactTile label="CI pipeline" value={d.ciDelta} decimals={1} prefix="+" suffix="s" cost />
        </div>

        <section>
          <SectionLabel>Invalidation chain</SectionLabel>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {d.chain.map((c, i) => (
              <Fragment key={`${c}-${i}`}>
                {i > 0 && <ArrowRight className="size-3 text-muted-foreground" />}
                <span className="rounded-md border border-border/70 bg-muted/30 px-2 py-0.5 font-mono text-[10px]">
                  {c}
                </span>
              </Fragment>
            ))}
          </div>
        </section>

        <section>
          <SectionLabel>Notes</SectionLabel>
          <ul className="mt-2 space-y-1.5">
            {d.notes.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/70" />
                {n}
              </li>
            ))}
          </ul>
        </section>

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-200/90">{d.suggestion}</p>
        </div>

        <Button variant="outline" size="sm" onClick={() => onNavigate?.('graph')}>
          View in graph
        </Button>
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------- split-crate tab */

function TimeBar({
  label,
  seconds,
  widthPct,
  tone,
}: {
  label: string
  seconds: number
  widthPct: number
  tone: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 font-mono text-[11px] text-muted-foreground">{label}</span>
      <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-muted/40">
        <motion.div
          className={cn('h-full rounded-full', tone)}
          initial={{ width: 0 }}
          animate={{ width: `${widthPct}%` }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-xs text-foreground">{seconds.toFixed(1)}s</span>
    </div>
  )
}

function SplitReport({
  query,
  onNavigate,
}: {
  query: QueryLike<ImpactPayload>
  onNavigate?: ViewProps['onNavigate']
}) {
  const { toast } = useToast()
  const [done, setDone] = useState<boolean[]>([])
  const d = query.data && query.data.kind === 'split-crate' ? (query.data as SplitImpact) : undefined

  if (query.isPending || (query.data === undefined && !query.isError)) {
    return (
      <Panel title="Architecture proposal">
        <TilesSkeleton count={4} />
      </Panel>
    )
  }

  if (!d) {
    return (
      <Panel title="Architecture proposal">
        <QueryError message={query.error?.message ?? 'unknown error'} onRetry={() => query.refetch()} />
      </Panel>
    )
  }

  const toggle = (i: number) => {
    const next = d.migration.map((_, j) => (j === i ? !(done[j] ?? false) : (done[j] ?? false)))
    setDone(next)
    if (next.every(Boolean)) {
      toast({ title: 'All steps marked — create the experiment to verify' })
    }
  }

  const afterPct = (d.proposal.buildSeconds / d.before.buildSeconds) * 100

  return (
    <Panel
      title={`Architecture proposal — split ${d.source}`}
      subtitle="monolith → focused crates, sized by real build telemetry"
      actions={<MeasurementBadge status={d.measurementStatus} />}
    >
      <div className="space-y-6">
        {/* before / after diagrams */}
        <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1.6fr]">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-sm font-semibold">{d.source}</p>
              <Badge variant="outline" className="font-mono text-[10px]">
                before
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {d.before.modules.map((m) => (
                <span
                  key={m}
                  className="rounded-md border border-border/70 bg-card px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {m}
                </span>
              ))}
            </div>
            <p className="mt-4 font-mono text-2xl font-semibold">{d.before.buildSeconds.toFixed(1)}s</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              fan-out {d.before.fanOut} · downstream {d.before.downstream}
            </p>
          </div>

          <div className="flex items-center justify-center">
            <ArrowDown className="size-5 text-primary lg:hidden" />
            <ArrowRight className="hidden size-5 text-primary lg:block" />
          </div>

          <div className="rounded-xl border border-dashed border-primary/40 bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/90">proposed split</p>
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-300"
              >
                total {d.proposal.buildSeconds.toFixed(1)}s
              </Badge>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {d.proposal.crates.map((c) => (
                <div key={c.name} className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-3">
                  <p className="font-mono text-xs font-semibold">{c.name}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.modules.map((m) => (
                      <span
                        key={m}
                        className="rounded border border-border/60 bg-card px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 font-mono text-lg font-semibold">{c.buildSeconds.toFixed(1)}s</p>
                  <p className="font-mono text-[10px] text-muted-foreground">downstream {c.downstream}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* build-time bars */}
        <section>
          <SectionLabel>Build time — affected subtree, clean build</SectionLabel>
          <div className="mt-3 space-y-2.5">
            <TimeBar
              label={`before · ${d.source}`}
              seconds={d.before.buildSeconds}
              widthPct={100}
              tone="bg-red-400/50"
            />
            <TimeBar
              label="after · split"
              seconds={d.proposal.buildSeconds}
              widthPct={afterPct}
              tone="bg-emerald-400/60"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3">
            <p className="font-mono text-3xl font-semibold text-emerald-300">
              +<CountUp value={d.improvementPct} decimals={1} suffix="%" />
            </p>
            <div className="space-y-1">
              <p className="text-xs font-medium text-emerald-200/90">clean-build improvement from the split</p>
              <MeasurementBadge status={d.measurementStatus} />
            </div>
          </div>
        </section>

        {/* migration checklist */}
        <section>
          <SectionLabel>Migration steps</SectionLabel>
          <div className="mt-3 space-y-1.5">
            {d.migration.map((step, i) => {
              const checked = done[i] ?? false
              return (
                <label
                  key={i}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 px-3 py-2.5 transition-colors hover:border-primary/30"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(i)}
                    className="mt-0.5"
                    aria-label={`Migration step ${i + 1}`}
                  />
                  <span className="font-mono text-[11px] text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                  <span className={cn('text-xs leading-snug', checked && 'text-muted-foreground line-through')}>
                    {step}
                  </span>
                </label>
              )
            })}
          </div>
        </section>

        {/* CTA */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
          <Button
            onClick={() => {
              toast({ title: 'Experiment draft created from this proposal (demo)' })
              onNavigate?.('experiments')
            }}
          >
            Create experiment from this proposal
          </Button>
          <p className="font-mono text-[11px] text-muted-foreground">opens experiments with a draft EXP</p>
        </div>
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------------------- view */

export default function SimulatorView({ onNavigate }: ViewProps) {
  const [mode, setMode] = useState<Mode>('add-dep')
  const [target, setTarget] = useState('')
  const [file, setFile] = useState('')

  const graph = useGraph()
  const blast: BlastEntry[] = useMemo(() => graph.data?.blast ?? [], [graph.data])
  // Catalogs are payload-driven per workspace; defaults derive during render
  // so a workspace switch never shows stale selections.
  const addDepOptions = graph.data?.catalog?.addDeps ?? []
  const activeTarget = target || addDepOptions[0]?.id || ''
  const splitSource = graph.data?.catalog?.splitCandidates[0] ?? ''
  const activeFile = file || blast[0]?.file || ''
  const addDepQuery = useImpact('add-dep', activeTarget)
  const editFileQuery = useImpact('edit-file', activeFile)
  const splitQuery = useImpact('split-crate', splitSource)

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Engineering Cost Calculator"
        title="What will this change cost?"
        description="Estimates derived from build telemetry × graph traversal — verified only through experiments."
        actions={<MeasurementBadge status="estimated" />}
      />

      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="add-dep">Add a dependency</TabsTrigger>
          <TabsTrigger value="edit-file">Edit a source file</TabsTrigger>
          <TabsTrigger value="split-crate">Split a crate</TabsTrigger>
        </TabsList>

        <TabsContent value="add-dep" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2 lg:col-span-1" role="radiogroup" aria-label="Dependency catalog">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Catalog</p>
              {graph.isPending &&
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              {addDepOptions.map((opt) => (
                <CatalogCard
                  key={opt.id}
                  id={opt.id}
                  version={opt.version}
                  active={activeTarget === opt.id}
                  onSelect={() => setTarget(opt.id)}
                />
              ))}
            </div>
            <div className="lg:col-span-2">
              <AddDepReport query={addDepQuery} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="edit-file" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="space-y-2 lg:col-span-2" role="radiogroup" aria-label="High-traffic source files">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                High-traffic files
              </p>
              {graph.isPending &&
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              {graph.isError && (
                <QueryError message={graph.error?.message ?? 'graph unavailable'} onRetry={() => graph.refetch()} />
              )}
              {blast.map((b) => (
                <button
                  key={b.file}
                  type="button"
                  role="radio"
                  aria-checked={b.file === activeFile}
                  onClick={() => setFile(b.file)}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors',
                    b.file === activeFile
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-border/70 bg-card hover:border-primary/30',
                  )}
                >
                  <p className="truncate font-mono text-[11px]">{b.file}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {b.crate}
                    </Badge>
                    <span className="font-mono text-[11px] text-muted-foreground">{b.affectedWorkspace} crates</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="lg:col-span-3">
              <EditFileReport query={editFileQuery} onNavigate={onNavigate} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="split-crate" className="mt-4">
          <SplitReport query={splitQuery} onNavigate={onNavigate} />
        </TabsContent>
      </Tabs>

      <p className="font-mono text-[11px] text-muted-foreground">
        All figures estimated (Gate 21) · ferrix experiment converts estimates into measured, verified results.
      </p>
    </div>
  )
}
