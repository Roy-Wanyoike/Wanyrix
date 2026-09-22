'use client'

import {
  CalendarClock,
  CheckCircle2,
  FlaskConical,
  MinusCircle,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ORGANIZATION } from '@/lib/wanyrix/data'
import { useGates } from '@/lib/wanyrix/hooks'
import { useAiStatusStore, type AiStatus } from '../ai-status-store'
import { Panel, SectionHeading } from '../shared'

const ROLE_LABEL: Record<string, string> = {
  owner: 'owner',
  admin: 'admin',
  member: 'member',
  viewer: 'viewer',
}

const AI_LABEL: Record<AiStatus, string> = {
  untested: 'not exercised this session',
  grounded: 'grounded ✓',
  deterministic: 'deterministic fallback',
}

/**
 * Organization (AUDIT-I3 required surface) — org profile, members and the
 * commercial tier model (pending-task.md §36: 90-day Free Trial → Developer →
 * Team → Enterprise), plus a live policy summary pulled from the gates API.
 *
 * Honesty: there is no auth/billing backend in this environment, so the org
 * data is an explicit FIXTURE (badged as such) — nothing here mutates or
 * pretends to be a live billing state. The policy summary panel is real data
 * from /api/wanyrix/gates.
 */
export default function OrganizationView() {
  const gates = useGates()
  const aiStatus = useAiStatusStore((s) => s.status)
  const org = ORGANIZATION

  const policyStats = gates.data
    ? {
        pass: gates.data.gates.filter((g) => g.status === 'pass').length,
        conditional: gates.data.gates.filter((g) => g.status === 'conditional').length,
        fail: gates.data.gates.filter((g) => g.status === 'fail').length,
        blocking: gates.data.gates.filter((g) => g.blocking).length,
        total: gates.data.gates.length,
      }
    : null

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Workspace"
        title="Organization"
        description="Org profile, plan and members — rendered from the local fixture registry; no auth or billing backend exists in this environment."
        actions={
          <Badge variant="outline" className="gap-1.5 border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-300">
            fixture data · demo environment
          </Badge>
        }
      />

      {/* org + plan header */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Profile" subtitle={`slug: ${org.slug}`} className="lg:col-span-1">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 font-mono text-lg font-bold text-primary">
              {org.name.slice(0, 1)}
            </span>
            <div>
              <p className="text-[15px] font-semibold">{org.name}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {org.seatsUsed}/{org.seatsTotal} seats in use · {org.members.filter((m) => m.status === 'active').length} active
                members
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-[12px] text-muted-foreground">
            <p className="flex items-center gap-2">
              <CalendarClock className="size-3.5 shrink-0 text-primary" aria-hidden />
              Trial started <span className="font-mono text-foreground/85">{new Date(org.trialStartedAt).toLocaleDateString()}</span>
            </p>
            <p className="flex items-center gap-2">
              <CalendarClock className="size-3.5 shrink-0 text-amber-400" aria-hidden />
              Trial ends <span className="font-mono text-foreground/85">{new Date(org.trialEndsAt).toLocaleDateString()}</span>
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground/90">
              Fixture dates — the commercial model is a 90-day free trial; core local/offline analysis never requires
              payment.
            </p>
          </div>
        </Panel>

        {/* live policy summary — real data */}
        <Panel
          title="Policy summary"
          subtitle="live from /api/wanyrix/gates — the release policy enforced for this org"
          className="lg:col-span-2"
          actions={
            gates.data ? (
              <Badge variant="outline" className="gap-1.5 border-primary/30 font-mono text-[10px] text-primary">
                <ShieldCheck className="size-3" />
                verdict: {gates.data.verdict}
              </Badge>
            ) : undefined
          }
        >
          {policyStats ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Pass', value: policyStats.pass, cls: 'text-emerald-300' },
                  { label: 'Conditional', value: policyStats.conditional, cls: 'text-amber-300' },
                  { label: 'Fail', value: policyStats.fail, cls: 'text-red-300' },
                  { label: 'Blocking', value: `${policyStats.blocking}/${policyStats.total}`, cls: 'text-foreground' },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-border/60 bg-muted/10 p-3">
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                    <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${s.cls}`}>{s.value}</p>
                  </div>
                ))}
              </div>
              <ul className="mt-4 space-y-2 border-t border-border/60 pt-3 text-[12.5px] text-muted-foreground">
                <li className="flex items-center gap-2">
                  <ShieldCheck className="size-3.5 shrink-0 text-primary" aria-hidden />
                  {policyStats.blocking} of {policyStats.total} policy gates are release-blocking
                </li>
                <li className="flex items-center gap-2">
                  <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
                  Cloud AI: optional · last status <span className="font-mono text-foreground/85">{AI_LABEL[aiStatus]}</span> — requests
                  sent only on explicit Explain actions
                </li>
                <li className="flex items-center gap-2">
                  <FlaskConical className="size-3.5 shrink-0 text-primary" aria-hidden />
                  Experiment policy: optimization claims verified via measured baseline → candidate runs before merge
                </li>
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading gates payload…</p>
          )}
        </Panel>
      </div>

      {/* members */}
      <Panel
        title="Members"
        subtitle={`${org.members.length} seats configured · read-only fixture`}
        bodyClassName="p-0"
        actions={
          <Badge variant="outline" className="gap-1.5 font-mono text-[10px] text-muted-foreground">
            <Users className="size-3" />
            {org.seatsUsed}/{org.seatsTotal} seats
          </Badge>
        }
      >
        <ul className="divide-y divide-border/60">
          {org.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/20 font-mono text-[11px] font-semibold text-muted-foreground">
                {m.name.split(' ').map((p) => p[0]).join('')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{m.name}</p>
                <p className="truncate font-mono text-[10.5px] text-muted-foreground">@{m.handle}</p>
              </div>
              <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                {ROLE_LABEL[m.role]}
              </Badge>
              {m.status === 'active' ? (
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-300">
                  <CheckCircle2 className="size-3" aria-hidden />
                  active · {m.lastActive}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                  <MinusCircle className="size-3" aria-hidden />
                  invited
                </span>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      {/* tiers */}
      <Panel title="Commercial tiers" subtitle="pending-task §36 model — 90-day free trial; local analysis always free">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {org.tiers.map((tier) => (
            <div
              key={tier.tier}
              className={`rounded-xl border p-4 ${
                tier.current
                  ? 'border-primary/40 bg-primary/5 shadow-[0_0_24px_-10px_oklch(0.72_0.16_45/40%)]'
                  : 'border-border/70 bg-card'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">{tier.name}</p>
                {tier.current && (
                  <Badge className="font-mono text-[9px] uppercase" variant="secondary">
                    current
                  </Badge>
                )}
              </div>
              <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{tier.blurb}</p>
              <ul className="mt-3 space-y-1.5">
                {tier.capabilities.map((c) => (
                  <li key={c} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-primary/70" aria-hidden />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/90">
          Tier capabilities mirror the documented commercial model; this environment has no payment backend, so no
          upgrade actions are offered here — by design, not by omission.
        </p>
      </Panel>
    </div>
  )
}
