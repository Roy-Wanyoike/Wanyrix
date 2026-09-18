/**
 * Task 3-b — theme-matrix unit test (absorbs tool-results/badge-contrast/contrast.mjs
 * as the living version; the .mjs artifact stays as the round-2 QA record).
 *
 * ENG-TCB-2 regression guard: every honesty-badge TEXT pair must hold WCAG AA
 * (≥ 4.5:1) in BOTH themes. Nothing is hardcoded:
 *   - theme surfaces (--card / --background, light + dark) are parsed from
 *     src/app/globals.css;
 *   - the palette oklch values are parsed from tailwind v4's theme.css (the
 *     actual token source the utilities resolve to);
 *   - the fg/tint pairs are parsed from the badge style maps in
 *     src/components/wanyrix/shared.tsx (MEASUREMENT_STYLES, CONFIDENCE_STYLES,
 *     SEVERITY_STYLES + DeltaBadge) — retuning a badge token re-runs the math
 *     automatically, and a token change that breaks AA now fails CI.
 *
 * Method (identical to the QA record): oklch → linear sRGB (Björn Ottosson
 * matrices) → sRGB gamma → gamma-space alpha compositing of the badge tint
 * over the theme surface (what the browser renders for `bg-x/10`) → WCAG 2.1
 * relative-luminance ratio.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

/* ------------------------------------------------------- oklch → sRGB math -- */
/* Absorbed verbatim from tool-results/badge-contrast/contrast.mjs. */

function oklchToLinearSrgb(L: number, C: number, Hdeg: number): [number, number, number] {
  const h = (Hdeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const gamma = (c: number): number =>
  c <= 0.00031306858 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055

const toSrgb = (lin: [number, number, number]): [number, number, number] =>
  lin.map((c) => Math.round(255 * Math.min(1, Math.max(0, gamma(c))))) as [number, number, number]

function oklchToSrgb(L: number, C: number, H: number): [number, number, number] {
  return toSrgb(oklchToLinearSrgb(L, C, H))
}

/* ------------------------------------------------------------------ WCAG -- */

const lin = (v8: number): number => {
  const c = v8 / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const lum = ([r, g, b]: [number, number, number]): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (fg: [number, number, number], bg: [number, number, number]): number => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}
/** gamma-space alpha compositing — what the browser renders for `bg-x/10`. */
const comp = (fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] =>
  fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as [number, number, number]

/* ------------------------------------------------------------- token parse -- */

interface Oklch {
  L: number
  C: number
  H: number
}

function parseOklchArgs(args: string): Oklch {
  const parts = args.trim().split(/\s+/)
  const rawL = parts[0]
  const L = rawL.endsWith('%') ? Number.parseFloat(rawL) / 100 : Number.parseFloat(rawL)
  const C = Number.parseFloat(parts[1])
  const H = Number.parseFloat(parts[2])
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) {
    throw new Error(`unparseable oklch(${args})`)
  }
  return { L, C, H }
}

function cssBlock(css: string, selector: string): string {
  const m = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`CSS block not found: ${selector}`)
  return m[1]
}

function oklchVar(block: string, name: string): Oklch {
  const m = block.match(new RegExp(`--${name}:\\s*oklch\\(\\s*([^)]+)\\)`))
  if (!m) throw new Error(`--${name} not found in block`)
  return parseOklchArgs(m[1])
}

const ROOT = join(import.meta.dir, '..', '..')
const globalsCss = readFileSync(join(ROOT, 'src', 'app', 'globals.css'), 'utf8')
const tailwindTheme = readFileSync(join(ROOT, 'node_modules', 'tailwindcss', 'theme.css'), 'utf8')
const sharedTsx = readFileSync(join(ROOT, 'src', 'components', 'wanyrix', 'shared.tsx'), 'utf8')

/** tailwind v4 palette: name → oklch (e.g. 'emerald-800' → {L:0.432,…}). */
function parsePalette(css: string): Map<string, Oklch> {
  const map = new Map<string, Oklch>()
  // `oklch(44.4% 0.177 26.899)` — theme.css writes lightness as a percentage,
  // globals.css writes it as a fraction; the parser normalizes both.
  const re = /--color-([a-z]+-\d+):\s*oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)[^)]*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    map.set(m[1], {
      L: Number.parseFloat(m[2]) / (m[3] === '%' ? 100 : 1),
      C: Number.parseFloat(m[4]),
      H: Number.parseFloat(m[5]),
    })
  }
  return map
}

/* -------------------------------------------------- badge pair extraction -- */

interface BadgePair {
  group: string
  name: string
  fgLight: string // palette key, e.g. 'emerald-800'
  fgDark: string // palette key, e.g. 'emerald-300'
  tint: string // palette key of the badge background hue, e.g. 'emerald-500'
  alpha: number // bg tint alpha parsed from `bg-x/20`-style utilities
}

function lightFg(cls: string): string {
  const m = cls.match(/(?:^|\s)text-([a-z]+-\d{2,3})/)
  if (!m) throw new Error(`no light text token in "${cls}"`)
  return m[1]
}
function darkFg(cls: string): string {
  const m = cls.match(/(?:^|\s)dark:text-([a-z]+-\d{2,3})/)
  if (!m) throw new Error(`no dark:text token in "${cls}"`)
  return m[1]
}
function bgTint(cls: string): { tint: string; alpha: number } {
  const m = cls.match(/(?:^|\s)bg-([a-z]+-\d{2,3})(?:\/(\d+))?/)
  if (!m) throw new Error(`no bg tint token in "${cls}"`)
  return { tint: m[1], alpha: m[2] ? Number(m[2]) / 100 : 1 }
}

function styleMap(name: string): [string, string][] {
  const m = sharedTsx.match(new RegExp(`const ${name}: Record<[^>]+, string> = \\{([^}]+)\\}`))
  if (!m) throw new Error(`style map ${name} not found in shared.tsx`)
  const entries: [string, string][] = []
  const re = /(\w+):\s*'([^']+)'/g
  let e: RegExpExecArray | null
  while ((e = re.exec(m[1])) !== null) entries.push([e[1], e[2]])
  return entries
}

function pairFrom(group: string, name: string, cls: string): BadgePair {
  const fg = bgTint(cls)
  return { group, name, fgLight: lightFg(cls), fgDark: darkFg(cls), tint: fg.tint, alpha: fg.alpha }
}

const BADGES: BadgePair[] = [
  ...styleMap('MEASUREMENT_STYLES').map(([k, v]) => pairFrom('measurement', k, v)),
  ...styleMap('CONFIDENCE_STYLES').map(([k, v]) => pairFrom('confidence', k, v)),
  ...styleMap('SEVERITY_STYLES').map(([k, v]) => pairFrom('severity', k, v)),
  ...(() => {
    const m = sharedTsx.match(/good\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/)
    if (!m) throw new Error('DeltaBadge good/bad classes not found in shared.tsx')
    return [pairFrom('delta', 'good', m[1]), pairFrom('delta', 'bad', m[2])]
  })(),
]

/* ------------------------------------------------------------------ suite -- */

const palette = parsePalette(tailwindTheme)

function color(key: string): Oklch {
  const c = palette.get(key)
  if (!c) throw new Error(`palette token --color-${key} not found in tailwind theme.css`)
  return c
}

function surfaceRatio(fgKey: string, tintKey: string, alpha: number, surface: [number, number, number]): number {
  const fg = oklchToSrgb(color(fgKey).L, color(fgKey).C, color(fgKey).H)
  const tint = oklchToSrgb(color(tintKey).L, color(tintKey).C, color(tintKey).H)
  return ratio(fg, comp(tint, alpha, surface))
}

/** sRGB of a theme surface variable (--card / --background) parsed from globals.css. */
function themeSurface(theme: 'light' | 'dark', name: 'card' | 'background'): [number, number, number] {
  const { L, C, H } = oklchVar(cssBlock(globalsCss, theme === 'light' ? ':root' : '\\.dark'), name)
  return oklchToSrgb(L, C, H)
}

describe('token sources are parsed, not hardcoded', () => {
  test('theme surfaces resolve from src/app/globals.css (light + dark, card + background)', () => {
    for (const theme of [':root', '\\.dark'] as const) {
      const block = cssBlock(globalsCss, theme)
      for (const v of ['card', 'background']) {
        const { L, C, H } = oklchVar(block, v)
        expect(L).toBeGreaterThan(0)
        expect(L).toBeLessThan(1)
        expect(C).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(H)).toBe(true)
      }
    }
    // sanity: the light card is (far) lighter than the dark card
    expect(oklchVar(cssBlock(globalsCss, ':root'), 'card').L).toBeGreaterThan(
      oklchVar(cssBlock(globalsCss, '\\.dark'), 'card').L,
    )
  })

  test('every palette token referenced by a badge resolves in tailwind theme.css', () => {
    expect(BADGES.length).toBeGreaterThanOrEqual(12) // the matrix must not silently shrink
    const referenced = new Set<string>()
    for (const b of BADGES) {
      referenced.add(b.fgLight)
      referenced.add(b.fgDark)
      referenced.add(b.tint)
    }
    for (const key of referenced) expect(palette.has(key)).toBe(true)
  })

  test('parser cross-check: emerald-800 equals the QA record’s hardcoded oklch triplet', () => {
    // contrast.mjs pinned oklch(0.432 0.095 166.913) by hand; the parser must
    // derive the same value from theme.css so both records agree.
    const c = color('emerald-800')
    expect(c.L).toBeCloseTo(0.432, 4)
    expect(c.C).toBeCloseTo(0.095, 4)
    expect(c.H).toBeCloseTo(166.913, 3)
  })

  test('badge pairs parsed from shared.tsx keep both a light and a dark text token', () => {
    for (const b of BADGES) {
      expect(b.fgLight).toMatch(/-\d{2,3}$/)
      expect(b.fgDark).toMatch(/-\d{2,3}$/)
      expect(b.alpha).toBeGreaterThan(0)
      expect(b.alpha).toBeLessThanOrEqual(1)
    }
  })
})

describe('honesty-badge text pairs on the theme CARD — WCAG AA (≥ 4.5:1) in both themes', () => {
  for (const b of BADGES) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${theme} · ${b.group}/${b.name}: ${theme === 'light' ? b.fgLight : b.fgDark} on ${b.tint}/${Math.round(b.alpha * 100)}%`, () => {
        const fgKey = theme === 'light' ? b.fgLight : b.fgDark
        const r = surfaceRatio(fgKey, b.tint, b.alpha, themeSurface(theme, 'card'))
        expect(r).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

describe('robustness — every badge also clears AA on the theme PAGE background', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: all ${BADGES.length} badge pairs ≥ 4.5:1 on --background`, () => {
      const page = themeSurface(theme, 'background')
      for (const b of BADGES) {
        const fgKey = theme === 'light' ? b.fgLight : b.fgDark
        const r = surfaceRatio(fgKey, b.tint, b.alpha, page)
        expect(r).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
