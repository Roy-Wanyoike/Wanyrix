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
  parseModelSections,
  redactViolations,
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

describe('explain grounding — payload limit constant', () => {
  test('request cap is 256 KB (ENG-TCA-7)', () => {
    expect(EXPLAIN_MAX_BODY_BYTES).toBe(256 * 1024)
  })
})
