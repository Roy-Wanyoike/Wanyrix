'use client'

import { CheckCircle2, ExternalLink, GitPullRequest, Github, RotateCcw, ScrollText, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useIssues } from '@/lib/ferrix/hooks'
import type { IssueItem } from '@/lib/ferrix/types'
import { REPO_URL } from '@/lib/ferrix/data'
import { Panel, SectionHeading, StatusDot } from '../shared'
import type { ViewProps } from '../view-types'

/* ------------------------------------------------------------------ styles */

const STATE_BADGE: Record<IssueItem['state'], string> = {
  merged: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  verified: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  'in-review': 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  open: 'border-border bg-muted/40 text-muted-foreground',
}

function StateBadge({ state }: { state: IssueItem['state'] }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${STATE_BADGE[state]}`}
    >
      {state}
    </span>
  )
}

/* ------------------------------------------------------------- issue card */

function IssueCard({ issue }: { issue: IssueItem }) {
  return (
    <div className="grid gap-4 rounded-xl border border-border/80 bg-card p-4 md:grid-cols-[1fr_auto]">
      {/* left — issue */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="font-mono text-sm font-semibold text-primary">{issue.id}</span>
          <a
            href={`${REPO_URL}/issues/${issue.ghIssue}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-mono text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            #{issue.ghIssue}
            <ExternalLink className="size-3" aria-hidden />
          </a>
          <span className="text-muted-foreground/40">·</span>
          <h3 className="text-[13.5px] font-medium leading-snug">{issue.title}</h3>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {issue.labels.map((label) => (
            <Badge key={label} variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
              {label}
            </Badge>
          ))}
          <span className="ml-1 inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <ShieldCheck className="size-3" aria-hidden />
            {issue.gate}
          </span>
        </div>

        {issue.verification && (
          <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-emerald-300/90">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-hidden />
            {issue.verification}
          </p>
        )}
      </div>

      {/* right — PR block */}
      {issue.pr && (
        <div className="min-w-[260px] rounded-lg border border-border/70 bg-background/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <GitPullRequest className="size-3.5 text-violet-300" aria-hidden />
            <span className="font-mono text-[12px] font-semibold">PR #{issue.pr.number}</span>
            <StateBadge state={issue.state} />
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{issue.pr.branch}</p>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {issue.pr.checks.map((check) => (
              <span key={check.name} className="inline-flex items-center gap-1.5">
                <StatusDot status={check.status} />
                <span className="font-mono text-[10px] text-muted-foreground">{check.name}</span>
              </span>
            ))}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
            <p className="font-mono text-[11px]">
              <span className="text-emerald-400">+{issue.pr.additions}</span>{' '}
              <span className="text-red-400">−{issue.pr.deletions}</span>
            </p>
            <a
              href={`${REPO_URL}/pull/${issue.pr.number}/files`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] text-primary hover:underline"
            >
              view diff →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- view */

function LoadingState() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-border/70 bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-2/5" />
          </div>
          <Skeleton className="mt-2.5 h-3.5 w-1/3" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

export default function IssuesView(_: ViewProps) {
  const { data, isLoading, isError, refetch } = useIssues()
  const issues = data?.issues ?? []

  const prCount = issues.filter((i) => i.pr).length
  const openCount = issues.filter((i) => i.state === 'open').length
  const unverifiedMerges = issues.filter((i) => i.state === 'merged' && !i.verification).length

  const summary = [
    `${issues.length} issues`,
    `${prCount} PRs`,
    `${openCount} open`,
    `${unverifiedMerges} unverified merges`,
  ]

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Traceability"
        title="Issues & PRs"
        description="Plan → GitHub issue → implementation PR → verification. Every issue is fixed by a PR (never direct commits to main)."
        actions={
          <Button size="sm" variant="outline" className="gap-1.5" asChild>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              <Github className="size-3.5" />
              Roy-Wanyoike/ferrix
            </a>
          </Button>
        }
      />

      {isLoading && <LoadingState />}

      {isError && (
        <Panel title="Traceability board unavailable">
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-red-300">
              Failed to load issues from <span className="font-mono">/api/ferrix/issues</span>.
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()} className="gap-1.5">
              <RotateCcw className="size-3.5" />
              Retry
            </Button>
          </div>
        </Panel>
      )}

      {data && (
        <>
          {/* summary chips */}
          <div className="flex flex-wrap items-center gap-2">
            {summary.map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-md border border-border/80 bg-muted/30 px-2.5 py-1 font-mono text-[11px] text-foreground/85"
              >
                {label}
              </span>
            ))}
            <span className="text-[11px] text-muted-foreground">
              issue numbers #1–#9 · PR numbers #10–#18 mirror the live repo
            </span>
          </div>

          {/* traceability board */}
          <div className="space-y-3" aria-label="Issue to PR traceability board">
            {issues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} />
            ))}
          </div>

          {/* footer */}
          <Panel title="Why this board exists" bodyClassName="p-4">
            <p className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
              <ScrollText className="mt-0.5 size-4 shrink-0 text-primary/80" aria-hidden />
              Governance requirement: work enters the repo only through reviewed PRs referencing their issue; merges
              ship with verification evidence. This view is the audit trail (Gates 71.48–71.51).
            </p>
          </Panel>
        </>
      )}
    </div>
  )
}
