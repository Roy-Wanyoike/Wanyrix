'use client'

import { useState } from 'react'
import { Sparkles, RefreshCw, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import ReactMarkdown from 'react-markdown'
import { useExplain } from '@/lib/wanyrix/hooks'
import type { ExplainRequest } from '@/lib/wanyrix/types'
import { aiStatusFromExplain, useAiStatusStore } from './ai-status-store'

/**
 * The AI reasoning layer entry point (Gate 9): consumes only structured
 * Wanyrix evidence, clearly separates fact / inference / recommendation /
 * uncertainty, and degrades to a deterministic fallback when the provider
 * is unavailable (Gate 18).
 */
export function ExplainDialog({
  context,
  question,
  kind = 'general',
  label = 'Explain with AI',
  title = 'Wanyrix AI reasoning',
  size = 'md',
}: {
  context: string
  question: string
  kind?: ExplainRequest['kind']
  label?: string
  title?: string
  size?: 'md' | 'lg'
}) {
  const [open, setOpen] = useState(false)
  const explain = useExplain()
  const setAiStatus = useAiStatusStore((s) => s.setStatus)

  /* every reasoning outcome feeds the honest system status pill (AUDIT-I3) */
  const run = () =>
    explain.mutate(
      { context, question, kind },
      {
        onSuccess: (data) => setAiStatus(aiStatusFromExplain(data)),
        onError: () => setAiStatus('deterministic'),
      },
    )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o && !explain.data && !explain.isPending) run()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary">
          <Sparkles className="size-3.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className={size === 'lg' ? 'max-w-2xl' : 'max-w-xl'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Grounded in structured Wanyrix evidence — the AI cannot override or re-label it.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border/70 bg-card/60 p-4 text-sm leading-relaxed">
          {explain.isPending && (
            <div className="space-y-2.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${92 - i * 9}%` }} />
              ))}
              <p className="pt-1 font-mono text-[11px] text-muted-foreground">reasoning over evidence…</p>
            </div>
          )}

          {explain.isError && (
            <p className="text-sm text-red-300">Request failed: {(explain.error as Error).message}</p>
          )}

          {explain.data && (
            <>
              {!explain.data.ok && (
                <p className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
                  <ShieldAlert className="size-3.5 shrink-0" />
                  Reasoning provider unavailable — showing the deterministic fallback.
                </p>
              )}
              <div className="prose prose-sm prose-invert max-w-none [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-1.5 [&_ul]:my-1.5 [&_li]:my-0.5">
                <ReactMarkdown>{(explain.data.explanation ?? explain.data.fallback ?? '').trim()}</ReactMarkdown>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] text-muted-foreground">
            {explain.data?.grounded ? 'grounded: evidence context ✓' : 'deterministic mode'}
          </p>
          <Button size="sm" variant="secondary" className="h-7 gap-1.5 text-xs" onClick={run} disabled={explain.isPending}>
            <RefreshCw className="size-3" />
            Regenerate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
