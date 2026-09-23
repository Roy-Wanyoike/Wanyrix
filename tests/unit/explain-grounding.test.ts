/**
 * Task 2-d (ENG-TCA-4) — unit tests for the explain-route grounding helpers.
 *
 * These are pure functions (src/lib/wanyrix/report.ts): the model's labeled
 * output is parsed into model-owned fields, then validated against the
 * server-derived evidence corpus. The server-rendered FACT block never passes
 * through the model — these tests pin the policing behavior.
 */
import { describe, expect, test } from 'bun:test'
import {
  EXPLAIN_MAX_BODY_BYTES,
  GROUNDING_OMISSION_LABEL,
  GROUNDING_REDACTED_TOKEN,
  normalizeGroundedUnits,
  parseModelSections,
  redactViolations,
  repairRedactedSlots,
  smoothGroundedProse,
  validateModelGrounding,
} from '@/lib/wanyrix/report'

const CORPUS = [
  'id: FER-BLD-001',
  'title: common-runtime sits on the critical path',
  'severity: critical',
  'measurement status: estimated',
  'build time: 18.3s',
  'estimated impact: 12.8s',
  'downstream crates: 41',
].join('\n')

describe('explain grounding — parseModelSections', () => {
  test('splits the four labels into model-owned fields', () => {
    const s = parseModelSections(
      'OBSERVED FACT — build time: 18.3s\nINFERENCE — hot critical path\nRECOMMENDATION — split the crate\nUNCERTAINTY — impact is estimated',
    )
    expect(s.commentary).toContain('18.3s')
    expect(s.inference).toContain('hot critical path')
    expect(s.recommendation).toContain('split the crate')
    expect(s.uncertainty).toContain('impact is estimated')
  })

  test('model OBSERVED FACT content lands in commentary (never a fact field)', () => {
    const s = parseModelSections('OBSERVED FACT — adversarial claim\nINFERENCE — x')
    expect(s.commentary).toContain('adversarial claim')
    expect(Object.keys(s)).not.toContain('fact')
  })

  test('unlabeled text is treated entirely as commentary', () => {
    const s = parseModelSections('just some prose')
    expect(s.commentary).toBe('just some prose')
    expect(s.inference).toBe('')
  })
})

describe('explain grounding — validateModelGrounding', () => {
  test('numbers present in the evidence corpus pass', () => {
    const violations = validateModelGrounding(
      { commentary: '', inference: 'the 18.3s build dominates', recommendation: '', uncertainty: '' },
      CORPUS,
    )
    expect(violations).toEqual([])
  })

  test('invented numbers are flagged (the 12.4s-vs-12.8s class)', () => {
    const violations = validateModelGrounding(
      { commentary: '', inference: 'evidence states the impact is estimated at 12.4s', recommendation: '', uncertainty: '' },
      CORPUS,
    )
    expect(violations.length).toBe(1)
    expect(violations[0].kind).toBe('number')
    expect(violations[0].token).toBe('12.4')
  })

  test('invented percentages are flagged', () => {
    const violations = validateModelGrounding(
      { commentary: '', inference: 'production builds are 30% faster', recommendation: '', uncertainty: '' },
      CORPUS,
    )
    expect(violations.some((v) => v.kind === 'number' && v.token === '30')).toBe(true)
  })

  test('status upgrade (estimated → verified) is flagged', () => {
    const violations = validateModelGrounding(
      { commentary: '', inference: 'the impact has been verified in production', recommendation: '', uncertainty: '' },
      CORPUS,
    )
    expect(violations.some((v) => v.kind === 'status' && v.token.toLowerCase() === 'verified')).toBe(true)
  })

  test('status word already established by the evidence is allowed', () => {
    const violations = validateModelGrounding(
      { commentary: '', inference: 'measurement status: estimated stays estimated', recommendation: '', uncertainty: '' },
      CORPUS,
    )
    expect(violations).toEqual([])
  })

  test('context-external id references (EXP-014 class) are flagged', () => {
    const violations = validateModelGrounding(
      { commentary: '', inference: '', recommendation: 'see EXP-014', uncertainty: '' },
      CORPUS,
    )
    expect(violations.some((v) => v.kind === 'reference' && v.token === 'EXP-014')).toBe(true)
  })

  test('quoted invented crate names are flagged', () => {
    const violations = validateModelGrounding(
      { commentary: '', inference: "no evidence for 'totally-real-crate-xyz'", recommendation: '', uncertainty: '' },
      CORPUS,
    )
    expect(violations.some((v) => v.kind === 'reference' && v.token === 'totally-real-crate-xyz')).toBe(true)
  })

  test('registry-record numbers beyond the fact cap are accepted (corpus = facts + context + record)', () => {
    const violations = validateModelGrounding(
      { commentary: '', inference: 'improvementPct 12.4 would help', recommendation: '', uncertainty: '' },
      `${CORPUS}\n{"improvementPct":12.4}`,
    )
    expect(violations).toEqual([])
  })
})

describe('explain grounding — redactViolations', () => {
  test('violating tokens are stripped from the quarantined text', () => {
    const sections = { commentary: '', inference: 'estimated at 12.4s and verified', recommendation: '', uncertainty: '' }
    const violations = validateModelGrounding(sections, CORPUS)
    const red = redactViolations(sections, violations)
    expect(red.inference).not.toContain('12.4')
    expect(red.inference).not.toContain('verified')
    expect(red.inference).toContain('⟨removed: not in evidence⟩')
  })
})

describe('explain grounding — smoothGroundedProse (issue #99 P4)', () => {
  test('the raw placeholder is exported verbatim (wire contract stays stable)', () => {
    expect(GROUNDING_REDACTED_TOKEN).toBe('⟨removed: not in evidence⟩')
  })

  test('raw placeholders render as an em-dash — removed claims stay removed', () => {
    const prose = `Build time is ⟨removed: not in evidence⟩ seconds and the impact is ⟨removed: not in evidence⟩ per clean build.`
    const smooth = smoothGroundedProse(prose)
    expect(smooth).not.toContain('⟨removed')
    expect(smooth).not.toContain('not in evidence⟩')
    expect(smooth).toBe(
      'Build time is — seconds and the impact is — per clean build.',
    )
  })

  test('prose without placeholders passes through untouched', () => {
    expect(smoothGroundedProse('clean deterministic fallback')).toBe('clean deterministic fallback')
    expect(smoothGroundedProse('')).toBe('')
  })
})

describe('explain grounding — payload limit constant', () => {
  test('request cap is 256 KB (ENG-TCA-7)', () => {
    expect(EXPLAIN_MAX_BODY_BYTES).toBe(256 * 1024)
  })
})

/* ==========================================================================
 * Issue #130 — AI fallback template slots & unit consistency.
 *
 * Browser-QA found "(+—ms)": the model wrote a computed delta "(+8.7ms)",
 * the ungrounded number 8.7 was redacted in place, and the #99 smoothing
 * rendered the leftover slot as a bare em-dash — an unfilled template
 * placeholder. The same prose attached "ms" to grounded build times the app
 * renders in seconds (87.4s). The pipeline is: normalizeGroundedUnits →
 * validateModelGrounding → redactViolations → repairRedactedSlots /
 * smoothGroundedProse — these tests pin each link plus the exact QA string.
 * ======================================================================== */

/** Mirrors the real health context: facts + raw JSON corpus (units are seconds app-wide). */
const TREND_CORPUS = [
  'workspace: helios-rs',
  'cache hit rate: 32',
  '{"workspace":"helios-rs","buildTrend":[{"month":"Apr","clean":64.2,"incremental":8.2},{"month":"Sep","clean":87.4,"incremental":16.9}],"cacheHitRate":32}',
].join('\n')

const TOKEN = GROUNDING_REDACTED_TOKEN

describe('explain grounding — normalizeGroundedUnits (issue #130 units)', () => {
  test('ms-denominated grounded numbers are relabeled to the app convention (seconds, one decimal)', () => {
    const sections = {
      commentary: 'incremental builds went from 8.2ms to 16.9ms',
      inference: '',
      recommendation: '',
      uncertainty: '',
    }
    const { sections: aligned, relabels } = normalizeGroundedUnits(sections, TREND_CORPUS)
    expect(aligned.commentary).toBe('incremental builds went from 8.2s to 16.9s')
    expect(relabels).toEqual([
      { field: 'commentary', from: '8.2ms', to: '8.2s' },
      { field: 'commentary', from: '16.9ms', to: '16.9s' },
    ])
  })

  test('relabeled numbers pass validation afterwards (the number itself was always grounded)', () => {
    const sections = {
      commentary: '',
      inference: 'the 8.2ms trend matters',
      recommendation: '',
      uncertainty: '',
    }
    const { sections: aligned } = normalizeGroundedUnits(sections, TREND_CORPUS)
    expect(validateModelGrounding(aligned, TREND_CORPUS)).toEqual([])
  })

  test('ms values the evidence itself states are left verbatim (engine metrics can be ms)', () => {
    const msCorpus = 'gate measured: startup 84ms · incremental <1s'
    const sections = {
      commentary: '',
      inference: 'startup takes 84ms',
      recommendation: '',
      uncertainty: '',
    }
    const { sections: aligned, relabels } = normalizeGroundedUnits(sections, msCorpus)
    expect(aligned.inference).toBe('startup takes 84ms')
    expect(relabels).toEqual([])
  })

  test('ungrounded numbers are never blessed with a unit — left for the validator to redact', () => {
    const sections = {
      commentary: '',
      inference: 'the delta is 8.7ms',
      recommendation: '',
      uncertainty: '',
    }
    const { sections: aligned, relabels } = normalizeGroundedUnits(sections, TREND_CORPUS)
    expect(aligned.inference).toBe('the delta is 8.7ms')
    expect(relabels).toEqual([])
    expect(validateModelGrounding(aligned, TREND_CORPUS).some((v) => v.kind === 'number' && v.token === '8.7')).toBe(true)
  })
})

describe('explain grounding — repairRedactedSlots (issue #130 slots)', () => {
  test('a redacted delta slot renders the explicit omission label — never a bare placeholder', () => {
    expect(repairRedactedSlots(`impact (+${TOKEN}ms)`)).toBe('impact (delta unavailable)')
    expect(repairRedactedSlots(`impact (${TOKEN} s)`)).toBe('impact (delta unavailable)')
    expect(repairRedactedSlots(`impact (+${TOKEN}%)`)).toBe('impact (delta unavailable)')
    expect(repairRedactedSlots(`impact (${TOKEN}MB)`)).toBe('impact (delta unavailable)')
    expect(repairRedactedSlots(`(${TOKEN}ms)`)).toBe(GROUNDING_OMISSION_LABEL)
  })

  test('mid-sentence redactions keep the #99 em-dash — only template slots become the label', () => {
    expect(repairRedactedSlots(`build is ${TOKEN} seconds slow`)).toBe(`build is ${TOKEN} seconds slow`)
    expect(smoothGroundedProse(`build is ${TOKEN} seconds slow`)).toBe('build is — seconds slow')
  })

  test('prose without slots passes through untouched', () => {
    expect(repairRedactedSlots('clean deterministic fallback')).toBe('clean deterministic fallback')
    expect(repairRedactedSlots('')).toBe('')
  })

  test('the omission label is the explicit honest marker (wire contract)', () => {
    expect(GROUNDING_OMISSION_LABEL).toBe('(delta unavailable)')
  })
})

describe('explain grounding — full #130 pipeline (browser-QA regression)', () => {
  const runPipeline = (commentary: string) => {
    const aligned = normalizeGroundedUnits({ commentary, inference: '', recommendation: '', uncertainty: '' }, TREND_CORPUS)
    const violations = validateModelGrounding(aligned.sections, TREND_CORPUS)
    const redacted = redactViolations(aligned.sections, violations)
    return {
      wire: repairRedactedSlots(redacted.commentary), // server-side payload repair
      rendered: smoothGroundedProse(redacted.commentary), // client-side renderer repair (defense in depth)
      relabels: aligned.relabels,
      violations,
    }
  }

  test('the exact QA string: grounded values keep app units, the ungrounded delta becomes an honest omission', () => {
    const { wire, rendered, relabels, violations } = runPipeline('incremental builds from 8.2ms to 16.9ms (+8.7ms)')
    const expected = 'incremental builds from 8.2s to 16.9s (delta unavailable)'
    expect(wire).toBe(expected)
    expect(rendered).toBe(expected)
    // consistent units with the app convention (overview trend axis "incremental (s)", insight "6.1s → 12.1s")
    expect(wire).toContain('8.2s')
    expect(wire).toContain('16.9s')
    expect(wire).not.toMatch(/\d+(\.\d+)?ms\b/)
    // no unfilled placeholder in any form
    expect(wire).not.toContain('⟨removed')
    expect(wire).not.toContain('(—')
    expect(wire).not.toContain('—ms')
    // provenance stays honest: units were relabeled, the delta number was redacted
    expect(relabels.map((r) => `${r.from}→${r.to}`)).toEqual(['8.2ms→8.2s', '16.9ms→16.9s'])
    expect(violations.some((v) => v.kind === 'number' && v.token === '8.7')).toBe(true)
  })

  test('both values grounded and no delta claimed → prose renders with consistent units and zero violations', () => {
    const { wire, rendered, violations } = runPipeline('incremental builds went from 8.2ms to 16.9ms in six months')
    expect(wire).toBe('incremental builds went from 8.2s to 16.9s in six months')
    expect(rendered).toBe(wire)
    expect(violations).toEqual([])
  })

  test('a value missing entirely (delta slot redacted alone) still renders the omission label', () => {
    const { rendered } = runPipeline('incremental builds from 8.2 to 16.9 (+8.7ms)')
    expect(rendered).toBe('incremental builds from 8.2 to 16.9 (delta unavailable)')
    expect(rendered).not.toContain('⟨removed')
    expect(rendered).not.toMatch(/\+—/)
  })
})

/* ==========================================================================
 * Issue #137 — provider prose unit drift. The #130 aligner only matched the
 * "ms" token, so word-form durations ("4 minutes", "2.5 hours") survived
 * grounding whenever their bare number was grounded by an unrelated fact
 * ("4 downstream crates"). Browser-QA (wave 1, qa-ux) reproduced this with
 * the shipped functions: minutes prose in, minutes prose out, 0 violations —
 * while every app surface renders seconds. The extended normalizeGroundedUnits
 * contract pinned below:
 *   - evidence states the exact seconds value → convert ("2 minutes" over
 *     "save 120s per run" → "120s");
 *   - bare number grounded → unit relabel, number untouched ("4 minutes" →
 *     "4s", the same rule the ms path has always used);
 *   - neither → left verbatim for validateModelGrounding to redact;
 *   - the corpus itself speaking in minutes ("3 minutes" heuristic budget)
 *     survives verbatim — the evidence is the unit authority;
 *   - compact compounds ("14m12s", "1h5m") convert only to an
 *     evidence-stated total.
 * ======================================================================== */

/** The exact QA repro corpus: seconds-only evidence; the bare 4 is grounded by "4 downstream crates". */
const QA_MINUTES_CORPUS = [
  'critical path 50.0s',
  'common-runtime 18.3s',
  'api 12.7s',
  '4 downstream crates',
  '2 upgrade scenarios',
  'save 120s per run',
].join('\n')

const QA_MINUTES_SECTIONS = {
  commentary: 'The full build takes about 4 minutes end to end.',
  inference: '',
  recommendation: 'Warm the cache to save 2 minutes per run.',
  uncertainty: '',
}

describe('explain grounding — normalizeGroundedUnits word durations (issue #137)', () => {
  test('the exact QA repro: minutes prose no longer survives a seconds-only corpus', () => {
    const { sections: aligned, relabels } = normalizeGroundedUnits(QA_MINUTES_SECTIONS, QA_MINUTES_CORPUS)
    // "2 minutes" = 120s and the evidence states exactly that value → converted
    expect(aligned.recommendation).toBe('Warm the cache to save 120s per run.')
    // "4 minutes" = 240s is NOT in the evidence, but the bare 4 is → unit relabel, number untouched
    expect(aligned.commentary).toBe('The full build takes about 4s end to end.')
    expect(relabels).toEqual([
      { field: 'commentary', from: '4 minutes', to: '4s' },
      { field: 'recommendation', from: '2 minutes', to: '120s' },
    ])
  })

  test('the aligned QA prose passes validation with zero violations (the #137 leak is closed)', () => {
    const { sections: aligned } = normalizeGroundedUnits(QA_MINUTES_SECTIONS, QA_MINUTES_CORPUS)
    expect(validateModelGrounding(aligned, QA_MINUTES_CORPUS)).toEqual([])
    expect(`${aligned.commentary} ${aligned.recommendation}`).not.toMatch(/\bminutes?\b/)
  })

  test('hours prose converts when the evidence states the seconds value', () => {
    const corpus = 'cold ci: 7200s worst case on this runner'
    const { sections: aligned, relabels } = normalizeGroundedUnits(
      { commentary: '', inference: 'cold CI can take 2 hours', recommendation: '', uncertainty: '' },
      corpus,
    )
    expect(aligned.inference).toBe('cold CI can take 7200s')
    expect(relabels).toEqual([{ field: 'inference', from: '2 hours', to: '7200s' }])
    expect(validateModelGrounding(aligned, corpus)).toEqual([])
  })

  test('seconds prose is compacted to the canonical Ns form when grounded', () => {
    const corpus = 'warm incremental run: 30s median'
    const { sections: aligned, relabels } = normalizeGroundedUnits(
      { commentary: '', inference: '', recommendation: 'keep the median warm run at 30 seconds', uncertainty: '' },
      corpus,
    )
    expect(aligned.recommendation).toBe('keep the median warm run at 30s')
    expect(relabels).toEqual([{ field: 'recommendation', from: '30 seconds', to: '30s' }])
  })

  test('a duration the corpus itself states verbatim survives (evidence is the unit authority)', () => {
    const corpus = 'heuristic: budget 3 minutes per run\n4 downstream crates'
    const sections = {
      commentary: '',
      inference: '',
      recommendation: 'stay inside the 3 minutes per run budget',
      uncertainty: '',
    }
    const { sections: aligned, relabels } = normalizeGroundedUnits(sections, corpus)
    expect(aligned.recommendation).toBe('stay inside the 3 minutes per run budget')
    expect(relabels).toEqual([])
    expect(validateModelGrounding(aligned, corpus)).toEqual([])
  })

  test('ungrounded minute claims are never blessed with a unit — left for the validator to redact', () => {
    const sections = {
      commentary: '',
      inference: 'the nightly clean build takes 9 minutes',
      recommendation: '',
      uncertainty: '',
    }
    const { sections: aligned, relabels } = normalizeGroundedUnits(sections, QA_MINUTES_CORPUS)
    expect(aligned.inference).toBe('the nightly clean build takes 9 minutes')
    expect(relabels).toEqual([])
    expect(validateModelGrounding(aligned, QA_MINUTES_CORPUS).some((v) => v.kind === 'number' && v.token === '9')).toBe(true)
  })

  test('compact compound durations ("14m12s" P4 nit) convert to an evidence-stated total', () => {
    const corpus = 'cold ci start measured 852s on this runner'
    const { sections: aligned, relabels } = normalizeGroundedUnits(
      { commentary: '', inference: 'cold start took 14m12s', recommendation: '', uncertainty: '' },
      corpus,
    )
    expect(aligned.inference).toBe('cold start took 852s')
    expect(relabels).toEqual([{ field: 'inference', from: '14m12s', to: '852s' }])
    expect(validateModelGrounding(aligned, corpus)).toEqual([])
  })

  test('compact compounds with hours convert too ("1h5m")', () => {
    const corpus = 'maintenance window: 3900s'
    const { sections: aligned, relabels } = normalizeGroundedUnits(
      { commentary: '', inference: '', recommendation: 'schedule maintenance runs 1h5m long', uncertainty: '' },
      corpus,
    )
    expect(aligned.recommendation).toBe('schedule maintenance runs 3900s long')
    expect(relabels).toEqual([{ field: 'recommendation', from: '1h5m', to: '3900s' }])
  })

  test('an unevidenced compound stays verbatim for the validator (no invented totals)', () => {
    const { sections: aligned, relabels } = normalizeGroundedUnits(
      { commentary: '', inference: 'cold start took 14m12s', recommendation: '', uncertainty: '' },
      QA_MINUTES_CORPUS,
    )
    expect(aligned.inference).toBe('cold start took 14m12s')
    expect(relabels).toEqual([])
    expect(validateModelGrounding(aligned, QA_MINUTES_CORPUS).some((v) => v.kind === 'number' && v.token === '14')).toBe(true)
  })

  test('mixed corpus: stated ms stays ms, stated minutes stay minutes, drifted minutes get relabeled', () => {
    const corpus = [
      'gate measured: startup 84ms',
      'critical path 50.0s',
      'heuristic: budget 3 minutes per run',
      '4 downstream crates',
    ].join('\n')
    const { sections: aligned, relabels } = normalizeGroundedUnits(
      {
        commentary: 'startup 84ms, critical path 50.0s, budget 3 minutes, plus 4 minutes wasted',
        inference: '',
        recommendation: '',
        uncertainty: '',
      },
      corpus,
    )
    expect(aligned.commentary).toBe('startup 84ms, critical path 50.0s, budget 3 minutes, plus 4s wasted')
    expect(relabels).toEqual([{ field: 'commentary', from: '4 minutes', to: '4s' }])
    expect(validateModelGrounding(aligned, corpus)).toEqual([])
  })

  test('full pipeline: every word-unit claim ends canonical or redacted — never minutes prose', () => {
    const sections = {
      commentary: 'The full build takes about 4 minutes end to end.',
      inference: 'the nightly clean build takes 9 minutes',
      recommendation: 'Warm the cache to save 2 minutes per run.',
      uncertainty: '',
    }
    const aligned = normalizeGroundedUnits(sections, QA_MINUTES_CORPUS)
    const violations = validateModelGrounding(aligned.sections, QA_MINUTES_CORPUS)
    const redacted = redactViolations(aligned.sections, violations)
    // normalization output carries no drifting word units
    expect(`${aligned.sections.commentary} ${aligned.sections.recommendation}`).not.toMatch(/\bminutes?\b/)
    // the one ungrounded claim was flagged and removed in place
    expect(violations.some((v) => v.kind === 'number' && v.token === '9')).toBe(true)
    expect(redacted.inference).toContain(GROUNDING_REDACTED_TOKEN)
    expect(aligned.relabels.map((r) => `${r.from}→${r.to}`)).toEqual(['4 minutes→4s', '2 minutes→120s'])
  })
})
