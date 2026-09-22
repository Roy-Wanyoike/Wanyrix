'use client'

import { useState } from 'react'
import {
  CheckCircle2,
  FolderPlus,
  Loader2,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import {
  useRegisteredWorkspaces,
  useRegisterWorkspace,
  useScanRegisteredWorkspace,
  useUnregisterWorkspace,
  EngineExecError,
  type EngineExecPayload,
  type RegisterWorkspaceResponse,
} from '@/lib/wanyrix/hooks'
import { useWorkspaceStore } from '@/lib/wanyrix/workspace-store'
import type { RegisteredWorkspaceSummary, Severity } from '@/lib/wanyrix/types'

/**
 * "Connect a local project" — the workspace registration bridge (Task 2-b).
 *
 * Registration is a REAL mutation: POST /api/wanyrix/workspaces { path }
 * makes the server run the actual wanyrix binary (doctor + graph) against
 * the path and persist the measured counts. Nothing here is simulated and
 * nothing is invented — the verdict panel only ever shows engine output.
 * Registered projects can be re-scanned (real exec, `?workspace=<id>`) and
 * removed (DELETE ?id=…).
 */

/** Severity dots — same color family the findings surfaces use. */
const SEV_DOT: Record<Severity, string> = {
  critical: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-teal-300',
}

/** Compact relative time for "last checked" labels (client-rendered). */
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'unknown'
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function ConnectProjectDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { toast } = useToast()
  const registered = useRegisteredWorkspaces()
  const connect = useRegisterWorkspace()
  const unregister = useUnregisterWorkspace()
  const rescan = useScanRegisteredWorkspace()

  const [pathInput, setPathInput] = useState('')
  const [verdict, setVerdict] = useState<RegisterWorkspaceResponse['verdict'] | null>(null)
  const [verdictName, setVerdictName] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null)
  /** fresh re-scan verdict per workspace id (shown inline under the row) */
  const [rescanVerdict, setRescanVerdict] = useState<
    Record<string, { findings: number; critical: number; warning: number; info: number }>
  >({})

  const onConnect = () => {
    setError(null)
    setVerdict(null)
    connect.mutate(pathInput, {
      onSuccess: (res) => {
        setVerdict(res.verdict)
        setVerdictName(res.workspace.name)
        setPathInput('')
        // QA-5-B-1: the journey no longer dead-ends after the dialog — the
        // connected project becomes the ACTIVE workspace immediately, and the
        // merged registry (selector/palette/Repositories) shows it first.
        useWorkspaceStore.getState().setActive(res.workspace.id)
        toast({
          title: `Connected ${res.workspace.name}`,
          description: `Real engine scan: ${res.verdict.crates} crates · ${res.verdict.edges} edges · ${res.verdict.findings} findings — now active in the workspace selector.`,
        })
      },
      onError: (err) => {
        const e = err as EngineExecError
        setError({ message: e.message, hint: e.hint })
      },
    })
  }

  const onRemove = (ws: RegisteredWorkspaceSummary) => {
    unregister.mutate(ws.id, {
      onSuccess: () => {
        setRescanVerdict((prev) => {
          const next = { ...prev }
          delete next[ws.id]
          return next
        })
        if (verdictName === ws.name) {
          setVerdict(null)
          setVerdictName(null)
        }
        toast({
          title: `Disconnected ${ws.name}`,
          description: 'The registered project was removed — nothing on disk was touched.',
        })
      },
      onError: (err) => {
        toast({ title: 'Remove failed', description: err.message, variant: 'destructive' })
      },
    })
  }

  const onScanNow = (ws: RegisteredWorkspaceSummary) => {
    setError(null)
    rescan.mutate(ws, {
      onSuccess: (payload: EngineExecPayload) => {
        const s = (payload.report.summary ?? {}) as {
          total?: number
          critical?: number
          warning?: number
          info?: number
        }
        const fresh = {
          findings: typeof s.total === 'number' ? s.total : 0,
          critical: typeof s.critical === 'number' ? s.critical : 0,
          warning: typeof s.warning === 'number' ? s.warning : 0,
          info: typeof s.info === 'number' ? s.info : 0,
        }
        setRescanVerdict((prev) => ({ ...prev, [ws.id]: fresh }))
        toast({
          title: `Re-scanned ${ws.name}`,
          description: `Real engine: ${fresh.findings} findings (${fresh.critical} critical · ${fresh.warning} warning · ${fresh.info} info).`,
        })
      },
      onError: (err) => {
        toast({ title: `Scan failed for ${ws.name}`, description: err.message, variant: 'destructive' })
      },
    })
  }

  return (
    <Dialog>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            className="hit-44 size-8"
            aria-label="Connect a local project"
            title="Connect a local Rust project — the real engine scans it"
          >
            <FolderPlus className="size-3.5" aria-hidden />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            <FolderPlus className="size-4 text-primary" />
            Connect a local project
          </DialogTitle>
          <DialogDescription>
            Registration runs the REAL wanyrix engine (doctor + graph) against the path you
            provide. Measured results only — nothing is simulated. Only your machine is involved.
          </DialogDescription>
        </DialogHeader>

        {/* connect input */}
        <div className="flex items-center gap-2">
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pathInput.trim().length > 0 && !connect.isPending) onConnect()
            }}
            placeholder="/absolute/path/to/your/rust/project"
            className="h-8 flex-1 font-mono text-xs"
            aria-label="Absolute path to your Rust project directory"
            spellCheck={false}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={onConnect}
            disabled={connect.isPending || pathInput.trim().length === 0}
          >
            {connect.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <FolderPlus className="size-3.5" aria-hidden />
            )}
            {connect.isPending ? 'Scanning…' : 'Connect'}
          </Button>
        </div>

        {/* measured verdict — only what the engine reported */}
        {verdict && (
          <div className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
              <CheckCircle2 className="size-3.5" aria-hidden />
              {verdictName ?? 'Project'} connected — measured by the real engine at registration
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-3">
              <span>
                crates <span className="tabular-nums text-foreground">{verdict.crates}</span>
              </span>
              <span>
                edges <span className="tabular-nums text-foreground">{verdict.edges}</span>
              </span>
              <span className="col-span-2 truncate sm:col-span-1" title={verdict.toolchain}>
                toolchain <span className="text-foreground">{verdict.toolchain}</span>
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className={`size-1.5 rounded-full ${SEV_DOT.critical}`} aria-hidden />
                {verdict.critical} critical
              </span>
              <span className="flex items-center gap-1">
                <span className={`size-1.5 rounded-full ${SEV_DOT.warning}`} aria-hidden />
                {verdict.warning} warning
              </span>
              <span className="flex items-center gap-1">
                <span className={`size-1.5 rounded-full ${SEV_DOT.info}`} aria-hidden />
                {verdict.info} info
              </span>
              <span className="ml-auto">
                {verdict.findings} findings · {verdict.engineVersion}
              </span>
            </div>
          </div>
        )}

        {/* named errors — the 503 build hint is rendered specially */}
        {error && (
          <div className="space-y-1.5 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">
            <p className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {error.message}
            </p>
            {error.hint && (
              <p className="rounded border border-red-500/25 bg-background/60 px-2 py-1 font-mono text-[10px] text-foreground/80">
                {error.hint}
              </p>
            )}
          </div>
        )}

        {/* registered projects */}
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/90">
            connected projects
          </p>
          {registered.isLoading && (
            <div className="space-y-2 py-1">
              {[0, 1].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}
          {registered.isError && (
            <div className="flex items-center justify-between rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">
              registered projects unavailable
              <Button size="sm" variant="outline" className="h-7" onClick={() => registered.refetch()}>
                retry
              </Button>
            </div>
          )}
          {registered.data && registered.data.length === 0 && (
            <p className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
              No projects connected yet — connect one above.
            </p>
          )}
          {registered.data && registered.data.length > 0 && (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {registered.data.map((ws) => {
                const fresh = rescanVerdict[ws.id]
                const scanning = rescan.isPending && rescan.variables?.id === ws.id
                return (
                  <li
                    key={ws.id}
                    className="rounded-lg border border-border/70 bg-card/60 p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{ws.name}</p>
                        <p
                          className="truncate font-mono text-[10px] text-muted-foreground"
                          title={ws.path}
                        >
                          {ws.path}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0"
                        onClick={() => onScanNow(ws)}
                        disabled={rescan.isPending}
                        aria-label={`Scan ${ws.name} now with the real engine`}
                        title="Scan now — runs the real wanyrix doctor against the registered path"
                      >
                        {scanning ? (
                          <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
                        ) : (
                          <RefreshCw className="size-3.5" aria-hidden />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0 text-muted-foreground hover:text-red-300"
                        onClick={() => onRemove(ws)}
                        disabled={unregister.isPending}
                        aria-label={`Remove ${ws.name} from connected projects`}
                        title="Disconnect — removes the registration, never the files"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                      <span>checked {relativeTime(ws.lastCheckedAt)}</span>
                      <span>{ws.crates} crates</span>
                      <span>{ws.edges} edges</span>
                      <span className="flex items-center gap-1">
                        <span className={`size-1.5 rounded-full ${SEV_DOT.critical}`} aria-hidden />
                        {ws.critical}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className={`size-1.5 rounded-full ${SEV_DOT.warning}`} aria-hidden />
                        {ws.warning}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className={`size-1.5 rounded-full ${SEV_DOT.info}`} aria-hidden />
                        {ws.info}
                      </span>
                    </p>
                    {fresh && (
                      <p className="mt-1 font-mono text-[10px] text-emerald-300" role="status">
                        fresh scan: {fresh.findings} findings ({fresh.critical} critical ·{' '}
                        {fresh.warning} warning · {fresh.info} info) — measured just now
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
