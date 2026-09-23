'use client'

import { Sparkles } from 'lucide-react'

import { cn } from '@/lib/utils'

import { useAiStatusStore, useOnlineStatus, type AiStatus } from './ai-status-store'

const AI_LABEL: Record<AiStatus, string> = {
  untested: 'AI standby',
  grounded: 'AI grounded',
  deterministic: 'AI fallback',
}

const AI_TITLE: Record<AiStatus, string> = {
  untested: 'Reasoning layer not exercised this session — requests are sent only when you trigger “Explain”.',
  grounded: 'Last reasoning request was grounded in the structured evidence context.',
  deterministic: 'Last reasoning request fell back to the deterministic explanation (provider unavailable or ungrounded).',
}

/**
 * System status pill (AUDIT-I3) — honest LOCAL state only:
 *  - online/offline from navigator.onLine (browser events, no probing)
 *  - AI availability from the last reasoning request of this session
 * No network calls are made beyond the ones the app already makes.
 * Clicking navigates to Settings, where both are explained in detail.
 */
export function SystemStatusPill({
  onNavigate,
  className,
}: {
  onNavigate?: (v: 'settings') => void
  className?: string
}) {
  const { mounted, online } = useOnlineStatus()
  const aiStatus = useAiStatusStore((s) => s.status)

  const dot = !mounted ? 'bg-zinc-400' : online ? 'bg-emerald-400' : 'bg-amber-400'
  const connectLabel = !mounted ? 'local' : online ? 'online' : 'offline'
  const title = !mounted
    ? 'System status'
    : online
      ? `Browser reports ${online ? 'online' : 'offline'} · ${AI_TITLE[aiStatus]}`
      : 'Browser reports offline — Wanyrix is local-first: the engine and your data live on this machine. Cloud/AI features stay unavailable.'

  return (
    <button
      type="button"
      onClick={() => onNavigate?.('settings')}
      className={cn(
        /* issue #144 (D-5): hit-44 — 32px pill keeps its visual size but gets a
           44×44 touch target in the topbar. */
        'hit-44 relative flex h-8 items-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-2.5 transition-colors hover:border-primary/30',
        className,
      )}
      aria-label={`System status: ${connectLabel}, ${AI_LABEL[aiStatus]} — open Settings`}
      title={title}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', dot)} aria-hidden />
      <span className="font-mono text-[10px] leading-none text-muted-foreground">{connectLabel}</span>
      <span className="hidden text-border sm:inline" aria-hidden>
        ·
      </span>
      <Sparkles className={cn('hidden size-3 shrink-0 sm:block', aiStatus === 'grounded' ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
      <span className="hidden font-mono text-[10px] leading-none text-muted-foreground md:inline">
        {AI_LABEL[aiStatus]}
      </span>
    </button>
  )
}
