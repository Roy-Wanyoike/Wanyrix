'use client'

import { useMemo, useState } from 'react'
import { Braces, RefreshCw, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useExplain, useGates, useGraph, useHealth, useDoctor } from '@/lib/wanyrix/hooks'
import { smoothGroundedProse } from '@/lib/wanyrix/report'
import type { ExplainRequest } from '@/lib/wanyrix/types'
import { aiStatusFromExplain, useAiStatusStore } from '../ai-status-store'
import { MeasurementBadge, Panel, SectionHeading } from '../shared'

/**
 * AI (AUDIT-I3 required surface) — the reasoning layer as a first-class view.
 *
 * Honesty rules enforced here:
 *  - the model only ever receives structured Wanyrix evidence (shown in full
 *    below the answer);
 *  - every response is stamped GROUNDED (evidence context attached) or
 *    DETERMINISTIC (provider fallback) — never presented as source of truth;
 *  - the FACT / INFERENCE / RECOMMENDATION / UNCERTAINTY legend tells the
 *    reader which claims to verify with experiments (Gate 9 / Gate 18);
 *  - engine measurement badges (measured/estimated/verified) come from the
 *    payloads, and the AI cannot re-label them.
 */

interface Preset {
  id: string
  label: string
  kind: NonNullable<ExplainRequest['kind']>
  question: string
  context: () => string
  note: string
}

const FALLBACK_QUESTION =
  'Explain this evidence for a Rust engineer: what matters, what is uncertain, and how would we verify an improvement?'

export default function AiView() {
  const health = useHealth()
  const doctor = useDoctor()
  const graph = useGraph()
  const gates = useGates()
  const explain = useExplain()
  const setAiStatus = useAiStatusStore((s) => s.setStatus)

  const presets = useMemo<Preset[]>(
    () => [
      {
        id: 'health',
        label: 'Workspace health',
        kind: 'impact',
        question: health.data?.insight?.question ?? FALLBACK_QUESTION,
        context: () =>
          JSON.stringify({
            workspace: health.data?.workspace,
            kpis: health.data?.kpis,
            buildTrend: health.data?.buildTrend,
            cacheHitRate: health.data?.cacheHitRate,
          }),
        note: 'KPIs + 6-month build trend (measured trend, deltas estimated)',
      },
      {
        id: 'findings',
        label: 'Doctor findings',
        kind: 'issue',
        question: 'Which findings matter most, why, and how would we verify each fix?',
        context: () =>
          JSON.stringify({
            workspace: doctor.data?.workspace,
            buildTime: doctor.data?.buildTime,
            estimatedRange: doctor.data?.estimatedRange,
            findings: doctor.data?.findings?.slice(0, 6),
          }),
        note: 'top doctor findings, each with its measurement status',
      },
      {
        id: 'duplicates',
        label: 'Duplicate dependencies',
        kind: 'general',
        question: 'Why do these duplicate versions persist and which upgrade actually closes them?',
        context: () =>
          JSON.stringify({
            duplicates: graph.data?.duplicates,
            resolutions: graph.data?.resolutions,
          }),
        note: 'duplicate groups + resolution paths (deterministic cargo tree)',
      },
      {
        id: 'gates',
        label: 'Release gates',
        kind: 'gate',
        question: 'Explain the release verdict and which conditional gates carry the most risk.',
        context: () =>
          JSON.stringify({
            verdict: gates.data?.verdict,
            rationale: gates.data?.rationale,
            blockingConditions: gates.data?.blockingConditions,
            gates: gates.data?.gates?.filter((g) => g.status !== 'pass'),
          }),
        note: 'verdict + failing/conditional gates only',
      },
    ],
    [health.data, doctor.data, graph.data, gates.data],
  )

  const [presetId, setPresetId] = useState(presets[0].id)
  const preset = presets.find((p) => p.id === presetId) ?? presets[0]
  const [question, setQuestion] = useState(preset.question)

  const pickPreset = (id: string) => {
    setPresetId(id)
    const next = presets.find((p) => p.id === id)
    if (next) setQuestion(next.question)
  }

  const context = preset.context()
  const ready = Boolean(health.data && doctor.data && graph.data && gates.data)

  const run = () =>
    explain.mutate(
      { context, question, kind: preset.kind },
      {
        onSuccess: (data) => setAiStatus(aiStatusFromExplain(data)),
        onError: () => setAiStatus('deterministic'),
      },
    )

  const response = explain.data

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Reasoning Layer"
        title="AI"
        description="Grounded explanation over structured Wanyrix evidence. AI is optional and never the source of truth — the engine's measured labels always win."
        actions={
          <Badge variant="outline" className="gap-1.5 border-primary/30 font-mono text-[10px] text-primary">
            <Sparkles className="size-3" />
            Gate 9 · Gate 18
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* ------------------------------------------------ composer + answer */}
        <div className="space-y-4">
          <Panel title="Ask over live evidence" subtitle="the context payload is assembled from real API data of the active workspace">
            <div className="flex flex-col gap-3">
              <Select value={presetId} onValueChange={pickPreset} disabled={!ready}>
                <SelectTrigger className="h-9 w-full text-xs sm:w-[240px]" aria-label="Evidence preset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="font-mono text-[10.5px] text-muted-foreground">{preset.note}</p>
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={2}
                aria-label="Question for the reasoning layer"
                className="text-[13px]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={run} disabled={explain.isPending || !ready} className="gap-1.5">
                  {explain.isPending ? (
                    <RefreshCw className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="size-3.5" aria-hidden />
                  )}
                  {response ? 'Regenerate' : 'Explain with AI'}
                </Button>
                <span className="font-mono text-[10px] text-muted-foreground">
                  request leaves the browser only when you trigger it
                </span>
              </div>
            </div>
          </Panel>

          <Panel
            title="Response"
            subtitle={response?.grounded ? 'grounded in the attached evidence context' : 'deterministic fallback or pending'}
          >
            {explain.isPending && (
              <div className="space-y-2.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-3 bg-muted" style={{ width: `${92 - i * 9}%` }} />
                ))}
                <p className="pt-1 font-mono text-[11px] text-muted-foreground">reasoning over evidence…</p>
              </div>
            )}

            {!explain.isPending && !response && (
              <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                No reasoning request yet — pick an evidence preset and ask.
              </div>
            )}

            {response && (
              <div className="space-y-3">
                {!response.ok && (
                  <p className="flex items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] text-amber-300">
                    <ShieldAlert className="size-3.5 shrink-0" />
                    Reasoning provider unavailable — this is the deterministic fallback compiled from the same
                    evidence. Treat it as the source of truth, not the model.
                  </p>
                )}
                {response.ok && response.grounded && (
                  <p className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-[11.5px] text-emerald-300">
                    <ShieldCheck className="size-3.5 shrink-0" />
                    Grounded — the response was constrained to the attached evidence context.
                  </p>
                )}
                <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border/70 bg-card/60 p-4 text-sm leading-relaxed [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_li]:my-0.5 [&_p]:my-1.5 [&_ul]:my-1.5">
                  {/* smoothGroundedProse: raw `⟨removed: not in evidence⟩` tokens
                      render as an em-dash — removed claims stay removed (#99) */}
                  <ReactMarkdown>{smoothGroundedProse((response.explanation ?? response.fallback ?? '').trim())}</ReactMarkdown>
                </div>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {response.ok && response.grounded
                    ? 'grounded: evidence context ✓ · the model cannot re-label measured facts'
                    : 'deterministic mode · identical evidence, rule-based text'}
                </p>
              </div>
            )}
          </Panel>

          <Panel
            title={
              <span className="flex items-center gap-2">
                <Braces className="size-3.5 text-primary" aria-hidden />
                Evidence context sent
              </span>
            }
            subtitle="full transparency — exactly what the reasoning layer received"
          >
            <details>
              <summary className="cursor-pointer font-mono text-[11px] text-muted-foreground hover:text-foreground">
                show payload ({(context.length / 1024).toFixed(1)} KB)
              </summary>
              <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-border/60 bg-muted/10 p-3 font-mono text-[10.5px] leading-relaxed text-foreground/85">
                {context}
              </pre>
            </details>
          </Panel>
        </div>

        {/* ------------------------------------------------ honesty side rail */}
        <div className="space-y-4">
          <Panel title="How to read a response" subtitle="labels are a contract, not decoration">
            <ul className="space-y-3 text-[12.5px] leading-relaxed">
              <li className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wide text-emerald-300">fact</p>
                <p className="mt-0.5 text-muted-foreground">
                  Deterministic engine evidence — the numbers attached above. Already labeled measured / estimated /
                  verified by the payload.
                </p>
              </li>
              <li className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wide text-amber-300">inference</p>
                <p className="mt-0.5 text-muted-foreground">
                  The model&apos;s interpretation of those facts. Plausible, not proven — verify before acting.
                </p>
              </li>
              <li className="rounded-lg border border-primary/25 bg-primary/5 p-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wide text-primary">recommendation</p>
                <p className="mt-0.5 text-muted-foreground">
                  Suggested next action. Becomes engineering-ready only with an experiment plan and a verification
                  path.
                </p>
              </li>
              <li className="rounded-lg border border-zinc-500/30 bg-zinc-500/5 p-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wide text-zinc-300">uncertainty</p>
                <p className="mt-0.5 text-muted-foreground">
                  Where evidence is thin or the provider fell back. The UI states it instead of hiding it — this
                  environment always shows the deterministic fallback banner when grounding fails.
                </p>
              </li>
            </ul>
          </Panel>

          <Panel title="Trust rules" subtitle="why AI here can't mislead you">
            <ul className="space-y-2.5 text-[12px] leading-relaxed text-muted-foreground">
              <li>• Evidence in, speculation labeled: the context payload is the only input the model sees.</li>
              <li>• Measurement badges (measured / estimated / verified) are set by the engine, never by the model.</li>
              <li>• If the provider is unavailable the view degrades to the deterministic fallback — the surface never goes dark and never invents.</li>
              <li>• Everything works with AI off: every other view is deterministic (local-first).</li>
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              <MeasurementBadge status="measured" />
              <MeasurementBadge status="estimated" />
              <MeasurementBadge status="verified" />
              <span className="font-mono text-[10px] text-muted-foreground">set by the engine only (Gate 21)</span>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
