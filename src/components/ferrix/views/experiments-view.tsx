'use client'

import { motion } from 'framer-motion'
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Copy,
  Database,
  FlaskConical,
  Loader2,
  Play,
  RotateCcw,
  Stethoscope,
  TriangleAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useExperiments } from '@/lib/ferrix/hooks'
import type { Experiment } from '@/lib/ferrix/types'
import { CountUp, MeasurementBadge, Panel, SectionHeading } from '../shared'
import { ExplainDialog } from '../explain-dialog'
import type { ViewProps } from '../view-types'

/* ------------------------------------------------------------------ utils */

function fmtDate(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

/* ------------------------------------------------------- methodology chips */

const PIPELINE = [
  'Finding',
  'Recommendation',
  'Candidate',
  'Sandbox',
  'check',
  'test',
  'benchmark',
  'compare',
  'approval',
  'apply',
]

/** Verified pipeline reaches `compare`; approval + apply are the pending org step. */
const PIPELINE_DONE = 8

function MethodologyPanel() {
  return (
    <Panel
      title="Methodology (Gate 10)"
      subtitle="an estimate may only be upgraded to verified inside this pipeline"
    >
      <div className="flex flex-wrap items-center gap-y-2" aria-label="Experiment methodology pipeline">
        {PIPELINE.map((stage, i) => {
          const done = i < PIPELINE_DONE
          return (
            <div key={stage} className="flex items-center">
              {i > 0 && <ArrowRight className="mx-1 size-3 shrink-0 text-muted-foreground/50" aria-hidden />}
              <span
                className={
                  done
                    ? 'inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] text-emerald-300'
                    : 'inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 font-mono text-[11px] text-muted-foreground'
                }
              >
                {done ? <CheckCircle2 className="size-3" aria-hidden /> : <CircleDashed className="size-3" aria-hidden />}
                {stage}
              </span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------------- sub blocks */

function StageChips({ stages }: { stages: Experiment['stages'] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {stages.map((s) => (
        <span
          key={s.name}
          className={
            s.state === 'done'
              ? 'inline-flex items-center gap-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300'
              : s.state === 'active'
                ? 'inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300'
                : s.state === 'failed'
                  ? 'inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-300'
                  : 'inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'
          }
        >
          {s.state === 'done' && <CheckCircle2 className="size-2.5" aria-hidden />}
          {s.state === 'active' && <Loader2 className="size-2.5 animate-spin" aria-hidden />}
          {s.state === 'pending' && <CircleDashed className="size-2.5" aria-hidden />}
          {s.state === 'failed' && <TriangleAlert className="size-2.5" aria-hidden />}
          {s.name}
        </span>
      ))}
    </div>
  )
}

function CommandBlock({ commands }: { commands: string[] }) {
  const { toast } = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commands.join('\n'))
      toast({ title: 'Commands copied to clipboard', description: `${commands.length} command(s)` })
    } catch {
      toast({ title: 'Clipboard unavailable', description: 'Select the commands manually.' })
    }
  }
  return (
    <div className="relative">
      <pre className="max-h-32 overflow-y-auto rounded-lg border border-border/70 bg-black/40 p-3 pr-12 font-mono text-[11px] leading-relaxed text-foreground/85">
        {commands.join('\n')}
      </pre>
      <Button
        size="icon"
        variant="ghost"
        onClick={copy}
        aria-label="Copy commands"
        className="absolute right-1.5 top-1.5 size-7 text-muted-foreground hover:text-foreground"
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  )
}

function EnvGrid({ env }: { env: Experiment['environment'] }) {
  const cells: [string, string][] = [
    ['toolchain', env.toolchain],
    ['os', env.os],
    ['profile', env.profile],
    ['cache', env.cache],
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border/70 bg-muted/30 p-2">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 font-mono text-[11px] text-foreground/90">{value}</p>
        </div>
      ))}
    </div>
  )
}

function MiniBars({ baseline, candidate }: { baseline: number; candidate: number }) {
  const candidatePct = Math.min(100, (candidate / baseline) * 100)
  return (
    <div className="mt-2 w-full space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/60">
          <motion.div
            className="h-full rounded-full bg-zinc-500"
            initial={{ width: 0 }}
            animate={{ width: '100%' }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        </div>
        <span className="font-mono text-[10px] text-zinc-400">{baseline.toFixed(1)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/60">
          <motion.div
            className="h-full rounded-full bg-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${candidatePct}%` }}
            transition={{ duration: 0.9, ease: 'easeOut', delay: 0.15 }}
          />
        </div>
        <span className="font-mono text-[10px] text-emerald-400">{candidate.toFixed(1)}</span>
      </div>
    </div>
  )
}

function HeaderMeta({ experiment }: { experiment: Experiment }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
        {experiment.findingId}
      </Badge>
      <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
        commit {experiment.commit}
      </Badge>
    </div>
  )
}

/* ------------------------------------------------------------ experiment 1 */

function VerifiedCard({ experiment }: { experiment: Experiment }) {
  const baseline = experiment.baseline
  const candidate = experiment.candidate
  return (
    <Card className="gap-4 border-emerald-500/30 py-0 shadow-[0_0_40px_-18px_oklch(0.75_0.12_175/35%)]">
      <div className="border-b border-emerald-500/20 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-sm font-semibold text-primary">{experiment.id}</span>
          <h3 className="text-sm font-semibold">{experiment.title}</h3>
          <HeaderMeta experiment={experiment} />
          <Badge className="ml-auto border-emerald-400/40 bg-emerald-500/20 text-[11px] font-semibold tracking-wide text-emerald-200">
            ✓ VERIFIED IMPROVEMENT
          </Badge>
        </div>
      </div>

      <div className="space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
        <div className="grid gap-4 lg:grid-cols-3">
          {/* baseline */}
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              baseline · {baseline?.runs}-run median
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-zinc-200">
              <CountUp value={baseline?.seconds ?? 0} decimals={1} suffix="s" />
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
              measured {baseline ? fmtDate(baseline.measuredAt) : '—'}
            </p>
            <div className="mt-2">
              <MeasurementBadge status="measured" />
            </div>
          </div>

          {/* improvement */}
          <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
            <ArrowRight className="size-4 text-emerald-400" aria-hidden />
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-emerald-300">
              <CountUp value={experiment.improvementPct ?? 0} decimals={1} prefix="+" suffix="%" />
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-emerald-200/70">measured improvement</p>
            <div className="w-full">
              <MiniBars baseline={baseline?.seconds ?? 1} candidate={candidate?.seconds ?? 0} />
            </div>
          </div>

          {/* candidate */}
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
            <p className="text-[11px] uppercase tracking-wide text-emerald-200/70">
              candidate · {candidate?.runs}-run median
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-emerald-300">
              <CountUp value={candidate?.seconds ?? 0} decimals={1} suffix="s" />
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
              measured {candidate ? fmtDate(candidate.measuredAt) : '—'}
            </p>
            <div className="mt-2">
              <MeasurementBadge status="verified" />
            </div>
          </div>
        </div>

        {/* tests */}
        {experiment.tests && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-300">
              <CheckCircle2 className="size-3" aria-hidden />
              {experiment.tests.passed.toLocaleString('en-US')} passed
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-300">
              <CheckCircle2 className="size-3" aria-hidden />
              {experiment.tests.failed} failed
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">cargo test --workspace</span>
          </div>
        )}

        <EnvGrid env={experiment.environment} />

        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">stages</p>
          <StageChips stages={experiment.stages} />
        </div>

        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">commands</p>
          <CommandBlock commands={experiment.commands} />
        </div>

        {experiment.conclusion && (
          <blockquote className="border-l-2 border-emerald-400 pl-3 text-[13px] leading-relaxed text-foreground/90">
            “{experiment.conclusion}”
          </blockquote>
        )}

        <div className="flex justify-end border-t border-border/60 pt-3">
          <ExplainDialog
            kind="issue"
            context={JSON.stringify(experiment)}
            question="Explain this experiment result and what makes it verified"
          />
        </div>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------ experiment 2 */

function RunningCard({ experiment }: { experiment: Experiment }) {
  const baseline = experiment.baseline
  return (
    <Card className="gap-4 border-amber-500/30 py-0">
      <div className="border-b border-amber-500/20 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-sm font-semibold text-primary">{experiment.id}</span>
          <h3 className="text-sm font-semibold">{experiment.title}</h3>
          <HeaderMeta experiment={experiment} />
          <Badge className="ml-auto gap-1.5 border-amber-400/40 bg-amber-500/15 text-[11px] font-semibold tracking-wide text-amber-200">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            RUNNING
          </Badge>
        </div>
      </div>

      <div className="space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
        <div className="grid gap-4 lg:grid-cols-3">
          {/* baseline (measured) */}
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              baseline · {baseline?.runs}-run median
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-zinc-200">
              <CountUp value={baseline?.seconds ?? 0} decimals={1} suffix="s" />
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
              measured {baseline ? fmtDate(baseline.measuredAt) : '—'}
            </p>
            <div className="mt-2">
              <MeasurementBadge status={experiment.claim} />
            </div>
          </div>

          {/* candidate pending — NO number is claimed (Gate 21) */}
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-amber-500/25 bg-amber-500/5 p-4">
            <Skeleton className="h-9 w-28 bg-amber-500/10" />
            <p className="font-mono text-[11px] text-muted-foreground">awaiting candidate</p>
            <p className="text-center text-[10px] leading-snug text-muted-foreground/70">
              no improvement number exists yet — nothing is claimed
            </p>
          </div>

          {/* candidate slot */}
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4">
            <Skeleton className="h-9 w-24 bg-muted/60" />
            <p className="font-mono text-[11px] text-muted-foreground">candidate — not measured</p>
          </div>
        </div>

        {/* Gate 21 callout */}
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
          <p className="text-[12px] leading-relaxed text-amber-200">
            <span className="font-semibold">IMPORTANT:</span> Estimated −34% is NOT claimed here — no improvement
            number is displayed until the benchmark compares baseline and candidate (Gate 21).
          </p>
        </div>

        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">stages</p>
          <StageChips stages={experiment.stages} />
        </div>

        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">commands</p>
          <CommandBlock commands={experiment.commands} />
        </div>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------ experiment 3 */

function DraftCard({ experiment }: { experiment: Experiment }) {
  const { toast } = useToast()
  return (
    <Card className="gap-4 border-dashed border-zinc-500/40 bg-card/50 py-0">
      <div className="border-b border-border/60 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-sm font-semibold text-muted-foreground">{experiment.id}</span>
          <h3 className="text-sm font-semibold text-foreground/80">{experiment.title}</h3>
          <HeaderMeta experiment={experiment} />
          <div className="ml-auto flex items-center gap-2">
            <MeasurementBadge status={experiment.claim} />
            <Badge
              variant="outline"
              className="font-mono text-[11px] tracking-wide text-zinc-400 border-zinc-500/40"
            >
              DRAFT
            </Badge>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Plan drafted from {experiment.findingId} — the experiment loop has not started. No baseline has been
          recorded, so no number can be claimed (estimated claim only).
        </p>

        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">stages</p>
          <StageChips stages={experiment.stages} />
        </div>

        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">commands</p>
          <CommandBlock commands={experiment.commands} />
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => toast({ title: 'Baseline run queued (demo)' })}
            className="h-8 gap-1.5"
          >
            <Play className="size-3.5" />
            Run baseline
          </Button>
        </div>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------- view */

function LoadingState() {
  return (
    <div className="space-y-4" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-border/70 bg-card p-4 sm:p-6">
          <Skeleton className="h-5 w-2/3" />
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="mt-4 h-16" />
        </div>
      ))}
    </div>
  )
}

export default function ExperimentsView({ onNavigate }: ViewProps) {
  const { data, isLoading, isError, refetch } = useExperiments()

  const verified = data?.experiments.find((e) => e.id === 'EXP-014')
  const running = data?.experiments.find((e) => e.id === 'EXP-015')
  const draft = data?.experiments.find((e) => e.id === 'EXP-016')
  const empty = data !== undefined && data.experiments.length === 0

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Optimization Experiments"
        title="Verify before you claim"
        description="Finding → Recommendation → Candidate → Sandbox → check → test → benchmark → compare → approval → apply. Estimates become verified only here."
      />

      <MethodologyPanel />

      {isLoading && <LoadingState />}

      {isError && (
        <Panel title="Experiments unavailable">
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-red-300">
              Failed to load experiments from <span className="font-mono">/api/ferrix/experiments</span>.
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()} className="gap-1.5">
              <RotateCcw className="size-3.5" />
              Retry
            </Button>
          </div>
        </Panel>
      )}

      {data && empty && (
        <Panel
          title={
            <span className="flex items-center gap-2">
              <FlaskConical className="size-4 text-primary" aria-hidden />
              No experiments recorded for {data.workspace}
            </span>
          }
          subtitle="the verification loop starts from a doctor finding"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex flex-1 flex-col items-start gap-3">
              <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                Ferrix never claims an improvement without a measured baseline/candidate pair. Run{' '}
                <span className="font-mono text-foreground/85">ferrix doctor</span> for this workspace, pick a finding
                marked experiment-eligible, and the engine will scaffold the experiment with full metadata (Gate 20).
              </p>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onNavigate?.('doctor')}>
                <Stethoscope className="size-3.5" aria-hidden />
                Open Build Doctor
              </Button>
            </div>
            {/* terminal-style placeholder — shows what a scaffolded experiment looks like */}
            <div
              className="scanlines w-full max-w-sm shrink-0 overflow-hidden rounded-lg border border-border bg-[oklch(0.12_0.004_60)] font-mono text-[11px] leading-relaxed"
              aria-hidden
            >
              <div className="flex items-center gap-1.5 border-b border-border/60 bg-black/30 px-3 py-1.5 text-[10px] text-muted-foreground">
                <span className="size-2 rounded-full bg-red-500/70" />
                <span className="size-2 rounded-full bg-amber-500/70" />
                <span className="size-2 rounded-full bg-emerald-500/70" />
                <span className="ml-1.5">ferrix experiment — awaiting first run</span>
              </div>
              <div className="space-y-1 px-3 py-2.5">
                <p className="text-muted-foreground">$ ferrix experiment start FER-…</p>
                <p className="text-primary">◇ scaffold ready — baseline: pending</p>
                <p className="text-muted-foreground">◇ candidate: —</p>
                <p className="text-muted-foreground">◇ check · test · benchmark · compare</p>
                <p className="flex items-center gap-1 text-emerald-300/80">
                  verdict: <span className="inline-block h-3 w-1.5 animate-pulse bg-emerald-300/80" />
                </p>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {data && !empty && (
        <div className="space-y-4" aria-label="Experiments">
          {verified && <VerifiedCard experiment={verified} />}
          {running && <RunningCard experiment={running} />}
          {draft && <DraftCard experiment={draft} />}
        </div>
      )}

      {data && !empty && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="size-3.5 shrink-0 text-primary/80" aria-hidden />
          Experiments persist baseline, candidate, environment, commands, tests and measurements — 100% metadata
          completeness (Gate 20).
        </p>
      )}
    </div>
  )
}
