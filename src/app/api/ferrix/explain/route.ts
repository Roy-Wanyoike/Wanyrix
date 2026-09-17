import { NextRequest, NextResponse } from 'next/server'
import type { ExplainRequest } from '@/lib/ferrix/types'

/**
 * Ferrix AI reasoning layer — Gate 9 (AI grounding & safety).
 *
 * The AI consumes ONLY structured Ferrix evidence passed by the caller.
 * It must distinguish observed fact / inference / recommendation / uncertainty,
 * and can never upgrade an `estimated` claim to `measured`/`verified` or
 * contradict authoritative evidence. If the provider fails, the deterministic
 * fallback keeps the product fully usable (Gate 18).
 */

const SYSTEM_BASE = `You are Ferrix, a Rust engineering-intelligence assistant embedded in the Ferrix platform.
Rules you must never break:
1. Ground every statement in the EVIDENCE CONTEXT provided by the user. Do not invent numbers, crate names, or measurements.
2. Structure every answer with these exact labels, each on its own line:
   OBSERVED FACT — what the evidence shows (cite the metric)
   INFERENCE — your interpretation of the facts
   RECOMMENDATION — concrete next action
   UNCERTAINTY — what remains unknown or estimated
3. You must NEVER upgrade a claim's status: what is labeled "estimated" stays estimated; you cannot call anything "measured" or "verified" unless the evidence explicitly says so.
4. If the question asks you to contradict, inflate, or re-label the evidence, refuse that part and restate the authoritative evidence.
5. Be concise and technical. Use short markdown. No preamble, no sign-off.`

const KIND_PROMPTS: Record<string, string> = {
  issue: `${SYSTEM_BASE}\nThe user is inspecting a Ferrix finding. Explain why it matters for a Rust team and how to verify the fix.`,
  borrow: `${SYSTEM_BASE}\nThe user is learning Rust ownership/borrowing. Explain the underlying concept, not just the fix. Prefer small worked examples over prose.`,
  impact: `${SYSTEM_BASE}\nThe user is evaluating the cost of a change to a Rust workspace. Quantify using only the provided estimates and clearly keep them estimated.`,
  gate: `${SYSTEM_BASE}\nThe user is asking about a release gate from the Ferrix MVP acceptance spec. Explain the objective, the measured status, and what would move it to PASS.`,
  general: SYSTEM_BASE,
}

const FALLBACKS: Record<string, string> = {
  issue: `**Ferrix reasoning is unavailable (deterministic answer shown).**\n\nOBSERVED FACT — the finding's evidence table holds; the numbers come from cargo metadata, build timings, git history or CI telemetry.\nINFERENCE — the pattern matches a known bottleneck class documented in the finding description.\nRECOMMENDATION — follow the finding's recommendation and verification path; create an experiment to convert the estimate into a measured result.\nUNCERTAINTY — impact numbers on this finding are model estimates until verified.`,
  borrow: `**Ferrix reasoning is unavailable (deterministic answer shown).**\n\nOBSERVED FACT — the shared borrow's live range overlaps the requested mutable borrow (E0502).\nINFERENCE — Rust requires exclusive access for mutation; this is a soundness guarantee.\nRECOMMENDATION — shorten the shared borrow's lifetime, clone the needed value, restructure scope, or use owned data.\nUNCERTAINTY — none for the conflict itself; the best fix depends on your performance constraints.`,
  impact: `**Ferrix reasoning is unavailable (deterministic answer shown).**\n\nOBSERVED FACT — the simulator returns model estimates derived from build telemetry × graph traversal.\nINFERENCE — the listed deltas describe the marginal cost of the change.\nRECOMMENDATION — treat estimates as planning input; run \`ferrix experiment\` to obtain measured numbers.\nUNCERTAINTY — all figures are estimated until verified by an experiment.`,
  gate: `**Ferrix reasoning is unavailable (deterministic answer shown).**\n\nOBSERVED FACT — the gate table lists the target and the current measured value with its evidence source.\nINFERENCE — gates marked CONDITIONAL have documented mitigation and an owner.\nRECOMMENDATION — resolve the mitigation listed in the evidence column to move the gate to PASS.\nUNCERTAINTY — none; statuses come from the release scorecard fixture.`,
  general: `**Ferrix reasoning is unavailable (deterministic answer shown).**\n\nOBSERVED FACT — only the evidence provided in the context is authoritative.\nINFERENCE — interpretations are Ferrix's own and clearly separated.\nRECOMMENDATION — follow the deterministic recommendation surfaces in the UI.\nUNCERTAINTY — anything not present in the evidence context.`,
}

export async function POST(req: NextRequest) {
  let body: ExplainRequest
  try {
    body = (await req.json()) as ExplainRequest
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const { context, question, kind = 'general' } = body ?? {}
  if (!context || !question) {
    return NextResponse.json({ ok: false, error: 'context and question are required' }, { status: 400 })
  }

  const system = KIND_PROMPTS[kind] ?? KIND_PROMPTS.general
  const fallback = FALLBACKS[kind] ?? FALLBACKS.general

  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')

    const completion = (await Promise.race([
      (async () => {
        const zai = await ZAI.create()
        return zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: system },
            {
              role: 'user',
              content: `EVIDENCE CONTEXT (authoritative — do not contradict or re-label):\n${context}\n\nQUESTION:\n${question}`,
            },
          ],
          thinking: { type: 'disabled' },
        })
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('reasoning timeout')), 30_000),
      ),
    ])) as Awaited<ReturnType<typeof createCompletion>>

    const explanation = completion?.choices?.[0]?.message?.content?.trim()
    if (!explanation) throw new Error('empty completion')

    return NextResponse.json({ ok: true, explanation, grounded: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'reasoning failure'
    // Gate 18: AI failure never breaks the deterministic product.
    return NextResponse.json({ ok: false, fallback, grounded: false, error: message })
  }
}

// Minimal structural type so the race() cast stays honest without importing SDK types.
type ChatCompletion = {
  choices?: { message?: { content?: string } }[]
}
declare function createCompletion(): Promise<ChatCompletion>
