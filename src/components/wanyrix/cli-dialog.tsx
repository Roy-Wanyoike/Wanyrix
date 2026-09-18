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

/**
 * CLI contract quick reference (round 10) — the web surfaces are a mirror of
 * the `wanyrix` CLI: same payloads, same exit codes, same `--json` switch on
 * every command. Every command row is copyable (Gate 19 toast on copy).
 */

const COMMANDS: { cmd: string; maps: string }[] = [
  { cmd: 'wanyrix doctor', maps: 'Build Doctor view — findings + evidence' },
  { cmd: 'wanyrix doctor --json', maps: 'GET /api/wanyrix/doctor?ws=…' },
  { cmd: 'wanyrix graph --duplicates --json', maps: 'Engineering Graph · duplicates panel' },
  { cmd: 'wanyrix impact add-dep <crate> --json', maps: 'Impact Simulator · add a dependency' },
  { cmd: 'wanyrix impact upgrade-dep <crate> --json', maps: 'Impact Simulator · upgrade a dependency' },
  { cmd: 'wanyrix impact edit-file <path> --json', maps: 'Impact Simulator · edit a source file' },
  { cmd: 'wanyrix report --json', maps: 'Topbar Report → JSON snapshot' },
  { cmd: 'wanyrix experiment start <finding-id>', maps: 'Experiments view — scaffold from a finding' },
]

const EXIT_CODES: { code: string; label: string; cls: string }[] = [
  { code: '0', label: 'success', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  { code: '1', label: 'findings present', cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  { code: '2', label: 'usage error', cls: 'text-orange-300 border-orange-500/30 bg-orange-500/10' },
  { code: '3', label: 'infrastructure failure', cls: 'text-red-300 border-red-500/30 bg-red-500/10' },
]

function CommandRow({ cmd, maps }: { cmd: string; maps: string }) {
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()
  return (
    <li className="group flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-border/70 hover:bg-accent/40">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/90">{cmd}</code>
      <span className="hidden shrink-0 text-[11px] text-muted-foreground md:inline">{maps}</span>
      <Button
        size="icon"
        variant="ghost"
        className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Copy command ${cmd}`}
        onClick={() => {
          navigator.clipboard?.writeText(cmd).catch(() => {})
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
          toast({ title: 'Command copied', description: `${cmd} — deterministic surface, no AI in the path` })
        }}
      >
        {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
      </Button>
    </li>
  )
}

export function CliContractDialog({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  trigger?: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <span onClick={() => onOpenChange(true)}>{trigger}</span>}
      <DialogContent className="max-w-lg" aria-describedby="cli-dialog-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TerminalSquare className="size-4 text-primary" aria-hidden />
            wanyrix CLI contract
          </DialogTitle>
          <DialogDescription id="cli-dialog-desc">
            Every web surface maps 1:1 to a CLI command — same payloads, same exit codes, and{' '}
            <span className="font-mono text-foreground/85">--json</span> on everything (Gate 18).
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-64 space-y-0.5 overflow-y-auto" aria-label="CLI commands">
          {COMMANDS.map((c) => (
            <CommandRow key={c.cmd} cmd={c.cmd} maps={c.maps} />
          ))}
        </ul>

        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
            exit codes
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
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
