'use client'

import { useState } from 'react'
import { Check, Copy, TerminalSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { ENGINE_VERSION } from '@/lib/wanyrix/engine-meta'

/**
 * CLI contract quick reference — the engine-backed web surfaces mirror the
 * real `wanyrix` binary (version shown from ENGINE_VERSION, engine-meta.ts):
 * same payloads, versioned envelopes, same `--json` switch, same exit codes
 * (0 success / 2 error / 101 broken pipe — see docs/CLI.md). Every command
 * row is copyable (Gate 19 toast on copy, wording honest per surface: the
 * AI row is an AI surface and says so). Web-only platform tools are labeled
 * as such.
 */

export const COMMANDS: { cmd: string; maps: string; ai?: boolean }[] = [
  { cmd: 'wanyrix doctor --exclude tests/fixtures --json', maps: 'Build Doctor view — findings + evidence; repeatable --exclude prunes a subtree, echoes it and counts the skip (wanyrix.doctor/v1)' },
  { cmd: 'wanyrix build --path <dir> --json', maps: 'Real engine binary panel → build — instrumented cargo build, measured wall clock + cache-hit rate (wanyrix.build/v1)' },
  { cmd: 'wanyrix graph --json', maps: 'Engineering Graph — measured edge list (wanyrix.graph/v1)' },
  { cmd: 'wanyrix health --json', maps: 'Scorecard view — KPI summary (wanyrix.health/v1)' },
  { cmd: 'wanyrix analyze --json', maps: 'one measured pass — doctor + graph + health embedded verbatim (wanyrix.analyze/v1)' },
  { cmd: 'wanyrix dependencies --json', maps: 'dependency intelligence — direct deps/dependents, fan-in/out, path-dep resolution, measured cycles (wanyrix.dependencies/v1)' },
  { cmd: 'wanyrix init --db scans.db', maps: 'workspace onboarding — measured identity recorded in .wanyrix/state.json, idempotent (wanyrix.init/v1)' },
  { cmd: 'wanyrix status --db scans.db --socket daemon.sock', maps: 'fresh measured snapshot + drift vs init + newest stored scan + daemon liveness (wanyrix.status/v1)' },
  { cmd: 'wanyrix experiment record --name fix --claim "halve build"', maps: 'Experiments view — hypothesis ledger; record → measure (2 real builds) → verify (measured improvement only) (wanyrix.experiment/v1)' },
  { cmd: 'wanyrix events --json', maps: 'durable event log — one append-only mirror of every real ledger transition; corrupt lines skipped and named (wanyrix.events/v1)' },
  { cmd: 'wanyrix ai --question "…"', maps: 'local AI (Ollama-class) — grounded on the measured evidence digest only; never source code, never a measurement (wanyrix.ai/v1)', ai: true },
  { cmd: 'wanyrix git --json', maps: 'Change Intelligence — measured git state: branch, dirty/changed/untracked files, changed crates, recent commits (wanyrix.git/v1)' },
  { cmd: 'wanyrix impact --crate <name> --json', maps: 'Impact & changes panel — measured dependents by kind, transitive reach, blast radius per mille (wanyrix.impact/v1)' },
  { cmd: 'wanyrix what-changed --db <store> --json', maps: 'Impact & changes panel — added/resolved/changed findings vs the stored baseline (wanyrix.what-changed/v1)' },
  { cmd: 'wanyrix export --path <dir> --json', maps: 'Exports view — artifacts-as-code: doctor/graph/health envelopes verbatim + a sha256-bound index.json; clock-free, relative paths, byte-identical re-runs (wanyrix.export/v1)' },
  { cmd: 'wanyrix sync push --remote <path|url> --json', maps: 'serverless team sync — a git branch IS the shared store: one measured pass committed to the registry branch (default wanyrix-registry) as exactly one deterministic commit; a byte-identical re-push is a measured no-op (committed:false); missing/non-git remote is a named refusal; no web mirror yet (wanyrix.sync/v1)' },
  { cmd: 'wanyrix sync pull --remote <path|url> --json', maps: 'serverless team sync — merges the registry branch into the local mirror (.wanyrix/sync/registry); differing content is a named SYNC-CONFLICT-n finding — local bytes kept, never a silent overwrite — and peer evidence tiers never upgrade (a peer-verified claim imports as peer-reported-verified); pulling before any push names the missing branch (wanyrix.sync/v1)' },
  { cmd: 'wanyrix activate --key <token-file|literal>', maps: 'verify an ed25519-signed entitlement token OFFLINE (zero network I/O) and cache it under .wanyrix/entitlement.json; tampered/expired tokens are named refusals, never cached (wanyrix.entitlement/v1)' },
  { cmd: 'wanyrix entitlement --json', maps: 'cached entitlement state — plan, seats (measured: this machine), expiry, 30-day grace, tier-gated surfaces; no license is an honest not-activated envelope (wanyrix.entitlement/v1)' },
  { cmd: 'wanyrix license keygen|issue', maps: 'maintainer tooling — mint 0600 signing keypairs + ed25519-signed entitlement tokens (free is never issued; private keys never committed) (wanyrix.license-keygen/v1 · wanyrix.entitlement.token/v1)' },
  { cmd: 'wanyrix store list', maps: 'History view — persisted scan runs (SQLite + WAL)' },
  { cmd: 'wanyrix daemon start', maps: 'Runtime view — cached measured scan over a local Unix socket' },
  { cmd: 'wanyrix telemetry ingest -', maps: 'Diagnostics view — redacted rustc JSON diagnostics (wanyrix.telemetry/v1)' },
  { cmd: 'wanyrix synth --crates 50 --out tmp/ws', maps: 'fixture workspaces — deterministic (seed, count) → byte-identical tree' },
]

export const EXIT_CODES: { code: string; label: string; cls: string }[] = [
  { code: '0', label: 'success — findings are data, not failure', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  { code: '2', label: 'error — bad usage, IO failure, a named refusal, or ok:false daemon frame', cls: 'text-orange-300 border-orange-500/30 bg-orange-500/10' },
  { code: '101', label: 'broken pipe — stdout closed early (Rust EPIPE panic, not a mapped code)', cls: 'text-muted-foreground border-border bg-muted/40' },
]

function CommandRow({ cmd, maps, ai }: { cmd: string; maps: string; ai?: boolean }) {
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()
  return (
    <li className="group flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-border/70 hover:bg-accent/40">
      <code className="min-w-0 flex-[2] truncate font-mono text-[12px] text-foreground/90">{cmd}</code>
      <span className="hidden min-w-0 flex-[3] truncate text-[11px] text-muted-foreground md:inline">{maps}</span>
      <Button
        size="icon"
        variant="ghost"
        className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Copy command ${cmd}`}
        onClick={() => {
          navigator.clipboard?.writeText(cmd).catch(() => {})
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
          toast({ title: 'Command copied', description: `${cmd} — ${ai ? 'local AI surface — labeled inference, never a measurement' : 'deterministic surface, no AI in the path'}` })
        }}
      >
        {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
      </Button>
    </li>
  )
}

/**
 * Issue #131 — dialog focus restoration. Radix's default close-focus behavior
 * targets the element registered via DialogTrigger; this dialog is opened by
 * external state (`open`/`onOpenChange` from app-shell), so no trigger is
 * registered and Escape/close/overlay-dismiss landed focus on <body>. The
 * invoking control (the sidebar "view CLI contract" button) is handed to the
 * dialog as a ref instead: `onCloseAutoFocus` cancels Radix's default and
 * moves focus back to it. Escape, the ✕ button and overlay clicks all funnel
 * through onCloseAutoFocus, so every close path is covered.
 */
export function restoreFocusToTrigger(event: Event, trigger: HTMLElement | null | undefined): void {
  if (!trigger || !trigger.isConnected) return
  event.preventDefault()
  trigger.focus()
}

export function CliContractDialog({
  open,
  onOpenChange,
  triggerRef,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  triggerRef?: React.RefObject<HTMLElement | null>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg sm:max-w-2xl"
        onCloseAutoFocus={(event) => restoreFocusToTrigger(event, triggerRef?.current)}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TerminalSquare className="size-4 text-primary" aria-hidden />
            wanyrix CLI contract
          </DialogTitle>
          <DialogDescription>
            The engine-backed surfaces mirror the real binary (engine v{ENGINE_VERSION}) —
            same payloads, same exit codes (0 / 2 / 101), and{' '}
            <span className="font-mono text-foreground/85">--json</span> with a
            versioned envelope on every read command (Gate 18). Simulator,
            report export, and experiments are web-only platform tools.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-64 space-y-0.5 overflow-y-auto" aria-label="CLI commands">
          {COMMANDS.map((c) => (
            <CommandRow key={c.cmd} cmd={c.cmd} maps={c.maps} />
          ))}
        </ul>

        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/90">
            exit codes (as implemented)
          </p>
          <div className="mt-2 grid grid-cols-1 gap-1.5">
            {EXIT_CODES.map((e) => (
              <div key={e.code} className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded border font-mono text-[11px] font-bold',
                    e.cls,
                  )}
                >
                  {e.code}
                </span>
                <span className="text-[11.5px] text-muted-foreground">{e.label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
          AI adds grounded explanations on top of the deterministic layer only — it never edits
          code silently (Gate 9 / Gate 19).
        </p>
      </DialogContent>
    </Dialog>
  )
}
