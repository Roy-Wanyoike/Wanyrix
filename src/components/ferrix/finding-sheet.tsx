'use client'

import { motion } from 'framer-motion'
import {
  Boxes,
  ChevronRight,
  FileDiff,
  FlaskConical,
  GitBranch,
  Network,
  Settings,
  Terminal as TerminalIcon,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useToast } from '@/hooks/use-toast'
import { useDiffQueueStore } from '@/lib/ferrix/diff-store'
import { useWorkspaceStore } from '@/lib/ferrix/workspace-store'
import type { Finding, RemediationKind } from '@/lib/ferrix/types'
import { ConfidenceBadge, CountUp, MeasurementBadge, SeverityBadge } from './shared'
import { ExplainDialog } from './explain-dialog'

const REMEDIATION_META: Record<RemediationKind, { icon: LucideIcon; label: string }> = {
  command: { icon: TerminalIcon, label: 'command' },
  config: { icon: Settings, label: 'config' },
  architecture: { icon: Boxes, label: 'architecture' },
  experiment: { icon: FlaskConical, label: 'experiment' },
  patch: { icon: FileDiff, label: 'patch' },
}

// experiment eligibility comes from the Finding payload (issue #34)

/**
 * Evidence-first drill-down for a single FER-xxx finding (issue #25).
 * Every rendered field comes from the Finding payload — nothing invented.
 */
export function FindingSheet({
  finding,
  onOpenChange,
  onNavigate,
}: {
  finding: Finding | null
  onOpenChange: (open: boolean) => void
  onNavigate?: (view: 'graph' | 'experiments') => void
}) {
  const RemMeta = finding ? REMEDIATION_META[finding.remediationKind] : null
  const { toast } = useToast()
  const activeWs = useWorkspaceStore((s) => s.active)
  const enqueueDiff = useDiffQueueStore((s) => s.enqueue)
  /* remediations that translate into a reviewable proposed change */
  const queueable = finding !== null && finding.remediationKind !== 'experiment' && finding.remediationKind !== 'architecture'

  return (
    <Sheet open={finding !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-border/80 bg-background p-0 sm:max-w-[460px]"
      >
        {finding && RemMeta && (
          <>
            {/* ------------------------------------------------ header */}
            <div className="rounded-lg bg-gradient-to-r from-amber-500/40 via-primary/30 to-amber-500/40 p-px">
              <SheetHeader className="gap-0 rounded-[calc(0.625rem-1px)] bg-card px-5 pb-4 pt-5 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] tracking-wide text-muted-foreground">
                    {finding.id}
                  </span>
                  <SeverityBadge severity={finding.severity} />
                  <MeasurementBadge status={finding.measurementStatus} />
                  <ConfidenceBadge level={finding.confidenceClass} />
                </div>
                <SheetTitle className="mt-2 text-[17px] font-semibold leading-snug tracking-tight">
                  {finding.title}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Full detail, evidence and remediation for finding {finding.id}
                </SheetDescription>
                <p className="mt-2 flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                  <GitBranch className="size-3 shrink-0 text-primary/80" aria-hidden />
                  section: {finding.section} · detector: {finding.detection}
                </p>
              </SheetHeader>
            </div>

            {/* ------------------------------------------------ body */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <Section title="What Ferrix observed">
                <p className="text-[13px] leading-relaxed text-foreground/90">
                  {finding.description}
                </p>
              </Section>

              <Section title={`Evidence (${finding.evidence.length})`}>
                <ul className="space-y-2">
                  {finding.evidence.map((ev, i) => (
                    <motion.li
                      key={ev.label}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 + i * 0.06, duration: 0.22 }}
                      className="rounded-lg border border-border/70 bg-card/70 p-2.5"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {ev.label}
                        </p>
                        <p className="shrink-0 font-mono text-[9.5px] italic text-muted-foreground/80">
                          {ev.source}
                        </p>
                      </div>
                      <p className="mt-0.5 font-mono text-[13px] tabular-nums text-foreground">
                        {ev.value}
                      </p>
                    </motion.li>
                  ))}
                </ul>
              </Section>

              <Section title="Affected">
                <div className="flex flex-wrap gap-1.5">
                  {finding.affected.map((entity) => (
                    <span
                      key={entity}
                      className="rounded-full border border-border/70 bg-card px-2 py-0.5 font-mono text-[11px] text-foreground/80"
                    >
                      {entity}
                    </span>
                  ))}
                </div>
              </Section>

              <Section title="Impact">
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
                  <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-amber-200">
                    <Zap className="mt-0.5 size-3.5 shrink-0 text-amber-300" aria-hidden />
                    {finding.impact}
                  </p>
                  {finding.impactSeconds !== undefined && (
                    <div className="mt-2.5 flex items-baseline gap-2 border-t border-amber-500/15 pt-2.5">
                      <span className="font-mono text-xl font-semibold tabular-nums text-amber-200">
                        +<CountUp value={finding.impactSeconds} decimals={1} />
                        s
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        per affected build
                      </span>
                      <span className="ml-auto">
                        <MeasurementBadge status={finding.measurementStatus} />
                      </span>
                    </div>
                  )}
                </div>
              </Section>

              <Section title="Recommended action">
                <div className="rounded-lg border-l-2 border-primary/50 bg-primary/5 p-3">
                  <div className="flex items-center gap-1.5">
                    <RemMeta.icon className="size-3.5 text-primary" aria-hidden />
                    <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-primary/90">
                      {RemMeta.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed">{finding.recommendation}</p>
                </div>
              </Section>

              <Section title="Verification path">
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border/70 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-foreground/85">
                  {finding.verificationPath}
                </pre>
              </Section>

              {/* confidence meter */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Confidence
                  </p>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {finding.confidence}%
                  </span>
                </div>
                <Progress
                  value={finding.confidence}
                  className="mt-1.5 h-1.5"
                  aria-label={`Confidence ${finding.confidence}%`}
                />
              </div>
            </div>

            {/* ------------------------------------------------ footer */}
            <SheetFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-card/60 px-5 py-3">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => onOpenChange(false)}
              >
                <Network className="size-3.5" aria-hidden />
                View in graph
                <ChevronRight className="size-3" aria-hidden />
              </Button>
              <div className="flex items-center gap-2">
                {queueable && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      if (!finding) return
                      enqueueDiff({
                        id: `diff-${Date.now()}`,
                        workspace: activeWs,
                        at: Date.now(),
                        source: 'finding',
                        kind: finding.remediationKind,
                        title: finding.title,
                        target: finding.affected[0] ?? finding.id,
                        suggestion: finding.recommendation,
                        findingId: finding.id,
                        estimate:
                          finding.impactSeconds !== undefined
                            ? `−${finding.impactSeconds}s per affected build`
                            : undefined,
                        status: 'pending',
                      })
                      toast({
                        title: 'Diff queued for review',
                        description: `${finding.id} remediation is in the Pending-diffs queue (Gate 19).`,
                      })
                    }}
                  >
                    <FileDiff className="size-3.5" aria-hidden />
                    Queue as diff
                  </Button>
                )}
                {finding.experimentEligible && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      onOpenChange(false)
                      onNavigate?.('experiments')
                    }}
                  >
                    <FlaskConical className="size-3.5" aria-hidden />
                    Create experiment
                  </Button>
                )}
                <ExplainDialog
                  kind="issue"
                  context={JSON.stringify(finding)}
                  question="Why does this finding matter for our Rust team and how do I verify the fix?"
                  label="Explain with AI"
                />
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}
