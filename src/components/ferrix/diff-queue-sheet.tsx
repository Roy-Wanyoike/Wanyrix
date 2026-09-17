'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ClipboardCopy,
  Download,
  FileDiff,
  Package,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useToast } from '@/hooks/use-toast'
import { useDiffQueueStore, type DiffEntry } from '@/lib/ferrix/diff-store'
import {
  buildPatchBundle,
  buildUnifiedDiff,
  bundleFilename,
  downloadText,
  patchFilename,
} from '@/lib/ferrix/patch'
import { useWorkspaceStore } from '@/lib/ferrix/workspace-store'
import { cn } from '@/lib/utils'

const SOURCE_LABEL: Record<DiffEntry['source'], string> = {
  'simulator:add-dep': 'impact simulator · add dependency',
  'simulator:edit-file': 'impact simulator · file edit',
  'simulator:split-crate': 'impact simulator · crate split',
  finding: 'doctor finding · remediation',
}

const KIND_LABEL: Record<string, string> = {
  patch: 'patch',
  config: 'config',
  command: 'command',
  architecture: 'architecture',
}

/** Structured, paste-able change document — explicitly a proposal, not a repo mutation. */
function proposedChangeText(e: DiffEntry): string {
  return [
    `# ferrix proposed change — apply manually (Gate 19: no silent modification)`,
    `# workspace: ${e.workspace}`,
    `# source:   ${SOURCE_LABEL[e.source]}`,
    `# target:   ${e.target}`,
    `# kind:     ${KIND_LABEL[e.kind] ?? e.kind}`,
    `# queued:   ${new Date(e.at).toISOString()}`,
    ``,
    e.suggestion,
    ...(e.estimate
      ? [``, `# estimated impact: ${e.estimate} (estimated — verify via ferrix experiment, Gate 21)`]
      : []),
  ].join('\n')
}

function DiffBlock({ entry, index }: { entry: DiffEntry; index: number }) {
  const { toast } = useToast()
  const activeWs = useWorkspaceStore((s) => s.active)
  const setStatus = useDiffQueueStore((s) => s.setStatus)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    if (!navigator.clipboard) {
      toast({ title: 'Copy failed', description: 'Clipboard is not available in this context.' })
      return
    }
    navigator.clipboard.writeText(proposedChangeText(entry)).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
        toast({
          title: 'Proposed change copied',
          description: 'A paste-able instruction document — nothing was applied to any repository (Gate 19).',
        })
      },
      () => toast({ title: 'Copy failed', description: 'Clipboard permission denied.' }),
    )
  }

  const downloadPatch = () => {
    try {
      downloadText(patchFilename(entry), buildUnifiedDiff(entry))
      toast({
        title: 'Patch downloaded',
        description: `${patchFilename(entry)} — a unified diff of the proposal document. Review before applying (Gate 19).`,
      })
    } catch {
      toast({ title: 'Download failed', description: 'Could not generate the patch in this context.' })
    }
  }

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ delay: Math.min(index * 0.04, 0.2), duration: 0.22 }}
      className={cn(
        'overflow-hidden rounded-lg border',
        entry.status === 'pending'
          ? 'border-border/80 bg-card'
          : 'border-border/50 bg-card/40 opacity-70',
      )}
    >
      {/* diff header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
        <FileDiff className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-primary/90">
          {KIND_LABEL[entry.kind] ?? entry.kind}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">· {entry.target}</span>
        <span
          className={cn(
            'ml-auto shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide',
            entry.status === 'pending' && 'border-amber-500/25 bg-amber-500/10 text-amber-300',
            entry.status === 'applied' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
            entry.status === 'dismissed' && 'border-border bg-muted text-muted-foreground',
          )}
        >
          {entry.status}
        </span>
      </div>

      {/* proposed change body */}
      <div className="diff-body px-3 py-2.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          proposed change · {SOURCE_LABEL[entry.source]}
        </p>
        <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-foreground/90">
          <span className="mr-1 select-none text-emerald-400">+</span>
          {entry.suggestion}
        </pre>
        {entry.estimate && (
          <p className="mt-2 flex items-center gap-1.5 border-t border-border/50 pt-2 font-mono text-[11px] text-amber-300">
            {entry.estimate}
            <span className="text-[9.5px] uppercase tracking-wide text-muted-foreground">estimated</span>
          </p>
        )}
      </div>

      {/* actions */}
      <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={copy}>
          {copied ? <Check className="size-3" /> : <ClipboardCopy className="size-3" />}
          Copy proposed change
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-[11px]"
          onClick={downloadPatch}
          aria-label={`Download unified diff patch for ${entry.target}`}
        >
          <Download className="size-3" />
          .patch
        </Button>
        {entry.status === 'pending' ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-[11px] text-emerald-300 hover:text-emerald-200"
              onClick={() => {
                setStatus(activeWs, entry.id, 'applied')
                toast({
                  title: 'Marked as applied (demo)',
                  description: 'Ferrix never touches your repository — this is a review-workflow state only (Gate 19).',
                })
              }}
            >
              <Check className="size-3" />
              Mark applied
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 gap-1.5 text-[11px]"
              onClick={() => setStatus(activeWs, entry.id, 'dismissed')}
            >
              <X className="size-3" />
              Dismiss
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 gap-1.5 text-[11px]"
            onClick={() => setStatus(activeWs, entry.id, 'pending')}
          >
            <RotateCcw className="size-3" />
            Re-open
          </Button>
        )}
      </div>
    </motion.li>
  )
}

export function DiffQueueSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const activeWs = useWorkspaceStore((s) => s.active)
  const entriesMap = useDiffQueueStore((s) => s.entries)
  const clearResolved = useDiffQueueStore((s) => s.clearResolved)
  const { toast } = useToast()

  const entries = useMemo(() => entriesMap[activeWs] ?? [], [entriesMap, activeWs])
  const pending = entries.filter((e) => e.status === 'pending')
  const resolved = entries.filter((e) => e.status !== 'pending')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-border/80 bg-background p-0 sm:max-w-[560px]"
      >
        <div className="rounded-lg bg-gradient-to-r from-amber-500/40 via-primary/30 to-amber-500/40 p-px">
          <SheetHeader className="gap-0 rounded-[calc(0.625rem-1px)] bg-card px-5 pb-4 pt-5 text-left">
            <div className="flex items-center gap-2">
              <FileDiff className="size-4 text-primary" aria-hidden />
              <SheetTitle className="text-[15px] font-semibold tracking-tight">
                Pending diffs
              </SheetTitle>
              {pending.length > 0 && (
                <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                  {pending.length} pending
                </span>
              )}
            </div>
            <SheetDescription className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Reviewable proposed changes queued by Ferrix. Ferrix never modifies your repository
              silently — every patch is presented as a diff for human review (Gate 19).
            </SheetDescription>
            {pending.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 h-7 w-fit gap-1.5 text-[11px]"
                onClick={() => {
                  try {
                    downloadText(bundleFilename(activeWs), buildPatchBundle(pending))
                    toast({
                      title: `Bundle downloaded — ${pending.length} diff${pending.length === 1 ? '' : 's'}`,
                      description:
                        'One .patch file, one Index block per proposal. Review each block before applying (Gate 19).',
                    })
                  } catch {
                    toast({ title: 'Download failed', description: 'Could not generate the bundle.' })
                  }
                }}
              >
                <Download className="size-3" />
                Download all ({pending.length})
              </Button>
            )}
          </SheetHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {entries.length === 0 ? (
            <div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-center">
              <FileDiff className="size-8 text-muted-foreground/40" aria-hidden />
              <p className="max-w-[300px] text-sm leading-relaxed text-muted-foreground">
                No diffs queued for this workspace yet.
                <br />
                Queue one from an Impact Simulator suggestion or a finding remediation — Ferrix
                will propose, never apply.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <ul className="space-y-3">
                <AnimatePresence initial={false}>
                  {pending.map((e, i) => (
                    <DiffBlock key={e.id} entry={e} index={i} />
                  ))}
                </AnimatePresence>
              </ul>

              {resolved.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      resolved · {resolved.length}
                    </h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2 text-[10.5px] text-muted-foreground"
                      onClick={() => {
                        clearResolved(activeWs)
                        toast({ title: 'Resolved entries cleared', description: 'Pending diffs are unaffected.' })
                      }}
                    >
                      <Trash2 className="size-3" />
                      Clear
                    </Button>
                  </div>
                  <ul className="space-y-3">
                    <AnimatePresence initial={false}>
                      {resolved.map((e, i) => (
                        <DiffBlock key={e.id} entry={e} index={i} />
                      ))}
                    </AnimatePresence>
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        {entries.length > 0 && (
          <div className="border-t border-border/60 bg-card/60 px-5 py-2.5">
            <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              <Package className="size-3 shrink-0" aria-hidden />
              queue persists locally per workspace · .patch = proposal document only · apply manually (Gate 19)
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
