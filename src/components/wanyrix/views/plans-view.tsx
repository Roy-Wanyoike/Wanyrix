'use client'

import { useState } from 'react'
import { Check, Copy, KeyRound, ShieldCheck, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel, SectionHeading } from '../shared'
import { cn } from '@/lib/utils'
import {
  ACTIVATION_HINT,
  HONESTY_LABEL,
  LICENSE_TIERS,
  type IssuablePlan,
  type TierStatus,
} from '@/lib/wanyrix/license'

/**
 * Plans (issue #94 E1) — the commercial tier surface of a local-first
 * product. Honesty rules baked into the copy:
 *   - Free is presented as the real, permanent tier it is (COMMERCIAL.md
 *     rule #1) — never a crippled demo of the paid rows;
 *   - no prices are invented: the direction only, per docs/COMMERCIAL.md
 *     ("price points are deliberately not published");
 *   - issuance is sandbox-local and labeled `estimated` — no payment method,
 *     no charge, never a faked checkout; the buttons mint REAL engine tokens
 *     (`wanyrix license issue`, ed25519) that `wanyrix activate` verifies
 *     offline;
 *   - errors from the issuer are shown verbatim — a refusal is information,
 *     never a spinner pretending to work.
 */

const STATUS_BADGE: Record<TierStatus, { label: string; cls: string }> = {
  'free-forever': {
    label: 'free forever',
    cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  },
  'sandbox-estimated': {
    label: 'sandbox · estimated',
    cls: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  },
  'release-server': {
    label: 'on-prem server at release',
    cls: 'border-border bg-muted/40 text-muted-foreground',
  },
}

interface IssuedToken {
  schema: string
  plan: string
  team: string
  seats: number
  issuedAtDay: number
  expiryDay: number
  nonce: string
  signature: string
}

interface IssueResult {
  plan: IssuablePlan
  token: IssuedToken
  honestyNote: string
  binaryVersion: string
}

/** UTC day-count → ISO date (the engine's day-granularity expiry semantics). */
function dayToIso(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

export default function PlansView() {
  const [pending, setPending] = useState<IssuablePlan | null>(null)
  const [issued, setIssued] = useState<IssueResult | null>(null)
  const [error, setError] = useState<{ title: string; detail: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const issue = (plan: IssuablePlan) => {
    if (pending) return
    setPending(plan)
    setError(null)
    // The team id is the display-only identifier carried in the token —
    // the local machine name is an honest default; no account exists.
    fetch('/api/wanyrix/license/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan, team: 'local-sandbox' }),
    })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null)
        if (!res.ok || typeof body !== 'object' || body === null) {
          setError({
            title: `Issuer refused (${res.status})`,
            detail:
              typeof body === 'object' && body !== null && 'error' in body
                ? String((body as { error: unknown }).error)
                : 'the issuer response was not JSON',
          })
          return
        }
        const { token, honesty, binary } = body as {
          token?: IssuedToken
          honesty?: { note?: string }
          binary?: { version?: string }
        }
        if (!token || token.schema !== 'wanyrix.entitlement.token/v1') {
          setError({ title: 'Issuer response is not a signed token', detail: 'refusing to display it' })
          return
        }
        setIssued({
          plan,
          token,
          honestyNote: honesty?.note ?? `Sandbox issuance — ${HONESTY_LABEL}.`,
          binaryVersion: binary?.version ?? '',
        })
      })
      .catch((e: unknown) => {
        setError({ title: 'Issuer unreachable', detail: e instanceof Error ? e.message : String(e) })
      })
      .finally(() => setPending(null))
  }

  const copyToken = () => {
    if (!issued) return
    navigator.clipboard?.writeText(JSON.stringify(issued.token, null, 2)).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Workspace"
        title="Plans"
        description="Local-first tiers (issue #94): the local product is permanently free; payment only ever adds collaboration and governance. No payment backend exists in this environment — sandbox issuance below mints a real offline-verifiable license token and is labeled estimated, never a purchase."
        actions={
          <Badge variant="outline" className="gap-1.5 border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-300">
            no payments · sandbox-local issuance
          </Badge>
        }
      />

      {/* ---------------- the three tiers ---------------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        {LICENSE_TIERS.map((tier) => {
          const badge = STATUS_BADGE[tier.status]
          return (
            <Panel
              key={tier.id}
              title={
                <span className="flex items-center gap-2">
                  {tier.name}
                  <Badge variant="outline" className={cn('font-mono text-[10px]', badge.cls)}>
                    {badge.label}
                  </Badge>
                </span>
              }
              subtitle={tier.price}
              bodyClassName="flex h-full flex-col gap-3"
            >
              <ul className="space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
                {tier.surfaces.map((s) => (
                  <li key={s} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground/80">{tier.footnote}</p>

              {tier.id === 'team' && (
                <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    disabled={pending !== null}
                    onClick={() => issue('team')}
                  >
                    <KeyRound className="size-3.5" aria-hidden />
                    {pending === 'team' ? 'issuing…' : 'Issue sandbox Team license'}
                    <span className="font-mono text-[9px] opacity-70">estimated</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    disabled={pending !== null}
                    onClick={() => issue('trial')}
                  >
                    <Sparkles className="size-3.5" aria-hidden />
                    {pending === 'trial' ? 'issuing…' : '14-day trial — no payment method'}
                    <span className="font-mono text-[9px] opacity-70">estimated</span>
                  </Button>
                </div>
              )}
              {tier.id === 'free' && (
                <p className="border-t border-border/60 pt-3 font-mono text-[11px] text-muted-foreground">
                  you are here — nothing to buy, nothing to activate
                </p>
              )}
              {tier.id === 'enterprise' && (
                <p className="border-t border-border/60 pt-3 font-mono text-[11px] text-muted-foreground">
                  no sandbox button — the sandbox issuer deliberately does not mint Enterprise tokens
                </p>
              )}
            </Panel>
          )
        })}
      </div>

      {/* ---------------- named error, verbatim ---------------- */}
      {error && (
        <Panel title="Issuer refused" subtitle="the named error is shown verbatim — never a silent failure">
          <p className="text-[13px] font-medium text-red-800 dark:text-red-300">{error.title}</p>
          <p className="mt-1 break-words font-mono text-[11.5px] leading-relaxed text-muted-foreground">
            {error.detail}
          </p>
        </Panel>
      )}

      {/* ---------------- the issued license/token, honestly ---------------- */}
      {issued && (
        <Panel
          title="Issued license token"
          subtitle={`wanyrix.entitlement.token/v1 · engine ${issued.binaryVersion} · plan ${issued.token.plan} · team ${issued.token.team} · ${issued.token.seats} seat${issued.token.seats === 1 ? '' : 's'}`}
          actions={
            <Badge variant="outline" className="gap-1.5 border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-300">
              {HONESTY_LABEL}
            </Badge>
          }
        >
          <div className="grid gap-3 text-[12px] text-muted-foreground sm:grid-cols-3">
            <p>
              valid from <span className="font-mono text-foreground/85">{dayToIso(issued.token.issuedAtDay)}</span>
            </p>
            <p>
              expires <span className="font-mono text-foreground/85">{dayToIso(issued.token.expiryDay)}</span>{' '}
              <span className="text-muted-foreground/70">(UTC day-count{issued.plan === 'trial' ? ' — 14-day trial' : ''})</span>
            </p>
            <p className="flex items-start gap-1.5">
              <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-hidden />
              ed25519 signature attached — verify offline
            </p>
          </div>
          <pre className="mt-3 max-h-56 overflow-auto rounded-lg border border-border/70 bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground/85">
            {JSON.stringify(issued.token, null, 2)}
          </pre>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-muted-foreground/80">{issued.honestyNote}</p>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={copyToken}>
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
              {copied ? 'copied' : 'Copy token JSON'}
            </Button>
          </div>
          <p className="mt-2 border-t border-border/60 pt-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground/80">
            {ACTIVATION_HINT}
          </p>
        </Panel>
      )}
    </div>
  )
}
