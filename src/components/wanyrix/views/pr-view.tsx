'use client'

import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Box,
  Copy,
  ExternalLink,
  FlaskConical,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Info,
  Network,
  Package,
  Zap,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { REPO_URL } from '@/lib/wanyrix/data'
import { usePRAnalysis } from '@/lib/wanyrix/hooks'
import type { PRAnalysis } from '@/lib/wanyrix/types'
import { ExplainDialog } from '../explain-dialog'
import { WanyrixLogo } from '../logo'
import { ConfidenceBadge, CountUp, MeasurementBadge, Panel, SectionHeading, StatusDot } from '../shared'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import type { ViewProps } from '../view-types'

/* ----------------------------------------------------- comment markdown */

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="my-2 text-[13px] leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="text-muted-foreground">{children}</em>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-4">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 marker:text-muted-foreground/90">{children}</li>,
  code: ({ children }) => (
    <code className="rounded bg-white/[0.08] px-1 py-0.5 font-mono text-[11.5px] text-primary">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-border/70 bg-black/30 p-3 font-mono text-xs leading-5 text-foreground/85">
      {children}
    </pre>
  ),
}

function MarkdownBody({ source }: { source: string }) {
  return (
    <div className="max-w-none">
      <ReactMarkdown components={MARKDOWN_COMPONENTS}>{source}</ReactMarkdown>
    </div>
  )
}

/* ---------------------------------------------------------- cause chain */

const CAUSE_ICON: Record<PRAnalysis['causeChain'][number]['kind'], { Icon: typeof Package; cls: string }> = {
  dep: { Icon: Package, cls: 'text-amber-300' },
  'proc-macro': { Icon: Zap, cls: 'text-orange-300' },
  crate: { Icon: Box, cls: 'text-teal-300' },
  fanout: { Icon: Network, cls: 'text-red-300' },
}

/* ----------------------------------------------------------------- view */

export default function PRView({ onNavigate }: ViewProps) {
  const { toast } = useToast()
  const { data: pr, isPending } = usePRAnalysis()
  const activeWorkspace = useWorkspaceStore((s) => s.active)

  if (isPending || !pr) {
    return (
      <div className="space-y-5">
        <SectionHeading
          eyebrow="Action"
          title="PR Analysis"
          description="Build regression triage — every number traces back to evidence, and every fix runs as an experiment first."
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-48" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    )
  }

  const totalAdditions = pr.files.reduce((acc, f) => acc + f.additions, 0)
  const totalDeletions = pr.files.reduce((acc, f) => acc + f.deletions, 0)
  const maxDiff = Math.max(...pr.files.map((f) => f.additions + f.deletions))
  const merged = pr.state === 'merged'

  const copyComment = async () => {
    try {
      await navigator.clipboard.writeText(pr.comment)
      toast({
        title: 'Comment copied',
        description: "wanyrix[bot]'s regression comment is on your clipboard.",
      })
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Clipboard is unavailable in this context.',
        variant: 'destructive',
      })
    }
  }

  const createExperiment = (title: string) => {
    toast({
      title: 'Experiment drafted',
      description: `${title} → queued as a draft in the experiment pipeline.`,
    })
    onNavigate?.('experiments')
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Action"
        title="PR Analysis"
        description={`Build regression triage for ${activeWorkspace} — every number traces back to evidence, and every fix runs as an experiment first.`}
      />

      {/* 1 — header */}
      <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <GitPullRequest className="size-5 shrink-0 text-primary" />
          <span className="font-mono text-sm text-muted-foreground">#{pr.number}</span>
          <h2 className="text-[15px] font-semibold tracking-tight">{pr.title}</h2>
          {merged ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300">
              <GitMerge className="size-3" />
              Merged
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Open
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border/60 pt-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">
              <GitBranch className="size-3 text-muted-foreground" />
              {pr.branch}
            </span>
            <ArrowRight className="size-3 text-muted-foreground" />
            <span className="inline-flex items-center rounded-md border border-border/80 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">
              {pr.base}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Avatar className="size-6">
              <AvatarFallback className="text-[10px]">{pr.author.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground">{pr.author}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Button variant="outline" size="sm" className="h-7 gap-1.5" asChild>
              <a href={`${REPO_URL}/pull/${pr.number}`} target="_blank" rel="noreferrer">
                View on GitHub
                <ExternalLink className="size-3" />
              </a>
            </Button>
            <ExplainDialog
              kind="issue"
              context={JSON.stringify(pr)}
              question="Why did this PR regress build time and what should we do?"
              label="Explain regression"
            />
          </div>
        </div>
      </div>

      {/* 2 — build impact + checks */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Build time impact" subtitle="incremental rebuild · estimated from the Cargo.lock diff">
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">baseline main</span>
                <span className="font-mono text-foreground/80">{pr.before}s</span>
              </div>
              <div className="relative h-6 overflow-hidden rounded bg-white/5">
                <motion.div
                  className="h-full origin-left rounded-[4px] bg-zinc-400/60"
                  style={{ width: `${(pr.before / pr.after) * 100}%` }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">this PR ({pr.branch})</span>
                <span className="font-mono text-red-300">{pr.after}s</span>
              </div>
              <div className="relative h-6 overflow-hidden rounded bg-white/5">
                <motion.div
                  className="h-full origin-left rounded-[4px] bg-gradient-to-r from-red-500/60 via-red-500/75 to-red-400/85"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
                />
                {/* regression delta zone — between baseline width and PR width */}
                <div
                  aria-hidden
                  className="absolute inset-y-0 border-l border-dashed border-foreground/40"
                  style={{
                    left: `${(pr.before / pr.after) * 100}%`,
                    right: 0,
                    backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 5px, rgba(248,113,113,0.16) 5px 10px)',
                  }}
                />
                <span
                  className="absolute top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-sm bg-black/40 px-1.5 py-0.5 font-mono text-[9px] text-red-100"
                  style={{ left: `calc(${(pr.before / pr.after) * 100}% + 6px)` }}
                >
                  +{(pr.after - pr.before).toFixed(1)}s vs main
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">regression</p>
              <p className="font-mono text-3xl font-semibold tracking-tight text-red-400">
                <CountUp value={pr.regressionPct} decimals={1} prefix="+" suffix="%" />
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300">
                {pr.affectedCrates} downstream crates
              </span>
              <ConfidenceBadge level={pr.confidenceClass} />
              <span className="font-mono text-[11px] text-muted-foreground">confidence {pr.confidence}</span>
              <MeasurementBadge status="estimated" />
            </div>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" />
            Estimated impact — verified only via experiment. Estimates are never presented as measurements (Gate 21).
          </p>
        </Panel>

        <Panel title="Checks" subtitle={`${pr.checks.length} required checks`}>
          <div className="divide-y divide-border/60">
            {pr.checks.map((c) => (
              <div key={c.name} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                <StatusDot status={c.status} />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate font-mono text-[11px]',
                    c.status === 'fail' ? 'text-red-300' : 'text-foreground/80',
                  )}
                >
                  {c.name}
                </span>
                {c.status === 'fail' && (
                  <span className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-1 font-mono text-[9px] uppercase tracking-wide text-red-300">
                    fail
                  </span>
                )}
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{c.duration}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* 3 — likely cause chain */}
      <Panel title="Likely cause" subtitle="dependency diff → proc-macro fan-out → rebuild amplification">
        <div>
          {pr.causeChain.map((cause, i) => {
            const { Icon, cls } = CAUSE_ICON[cause.kind]
            return (
              <div key={cause.label}>
                {i > 0 && <div aria-hidden className="ml-[13px] h-4 w-px bg-border/70" />}
                <div className="flex items-center gap-3">
                  <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border border-border bg-white/5">
                    <Icon className={cn('size-3.5', cls)} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{cause.label}</p>
                    {cause.note && <p className="truncate font-mono text-[11px] text-muted-foreground">{cause.note}</p>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      {/* 4 — bot comment + suggested alternatives */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <WanyrixLogo size={20} />
              wanyrix[bot]
              <span className="text-[11px] font-normal text-muted-foreground">
                {merged ? 'commented before merge' : 'commented 2m ago'}
              </span>
            </span>
          }
          actions={
            <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-300">
              regression
            </span>
          }
        >
          <MarkdownBody source={pr.comment} />
          <div className="mt-4 flex justify-end gap-2 border-t border-border/60 pt-3">
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={copyComment}>
              <Copy className="size-3.5" />
              Copy comment
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => onNavigate?.('experiments')}
            >
              <FlaskConical className="size-3.5" />
              Open experiments
            </Button>
          </div>
        </Panel>

        <Panel title="Suggested alternatives" subtitle="run each as an experiment — savings stay estimated until verified">
          <div className="space-y-3">
            {pr.suggestions.map((s) => (
              <div
                key={s.title}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-white/[0.02] p-3"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{s.title}</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{s.detail}</p>
                  <p className="mt-1.5 font-mono text-[11px] text-emerald-300">{s.estimatedSaving}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5"
                  onClick={() => createExperiment(s.title)}
                >
                  <FlaskConical className="size-3.5" />
                  Create experiment
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* 5 — files changed */}
      <Panel
        title="Files changed"
        subtitle={
          <span className="font-mono text-[11px]">
            <span className="text-emerald-300">+{totalAdditions}</span>{' '}
            <span className="text-red-300">−{totalDeletions}</span> · {pr.files.length} files
          </span>
        }
      >
        <div className="divide-y divide-border/60">
          {pr.files.map((f) => (
            <div
              key={f.name}
              className="flex items-center gap-3 rounded-sm px-1 py-2 transition-colors first:pt-0 last:pb-0 hover:bg-white/[0.04]"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/85">{f.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-emerald-300">+{f.additions}</span>
              <span className="shrink-0 font-mono text-[11px] text-red-300">−{f.deletions}</span>
              <span className="flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-white/5" aria-hidden>
                <span className="bg-emerald-400/80" style={{ width: `${(f.additions / maxDiff) * 100}%` }} />
                <span className="bg-red-400/80" style={{ width: `${(f.deletions / maxDiff) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" />
        All impact figures on this page are estimates until verified by a Wanyrix experiment (Gate 20).
      </p>
    </div>
  )
}
