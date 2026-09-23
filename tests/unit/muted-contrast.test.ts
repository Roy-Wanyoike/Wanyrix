/**
 * Task 4-b — theme-token contrast suite for `--muted-foreground` (issue #131).
 *
 * The M10 axe run flagged 11 confirmed color-contrast violations, all muted
 * `text-muted-foreground` text (nav/sidebar chrome) — the confirmed failures
 * were the OPACITY-COMPOSITED variants (`/60`–`/80` over light surfaces),
 * which axe evaluates after alpha composition, not the full-opacity token.
 * The fix (this suite pins it):
 *   1. token retune — light `oklch(0.5 0.015 65)` → `oklch(0.47 0.02 60)`,
 *      dark `oklch(0.68 0.012 70)` → `oklch(0.72 0.015 70)` (same warm hue
 *      family, no brand change);
 *   2. every text usage of `text-muted-foreground/<n>` raised to `/90` — the
 *      lowest step that clears AA (≥ 4.5:1) on EVERY theme surface in BOTH
 *      themes after gamma-space alpha composition (aria-hidden decorations
 *      keep their dimmer steps: axe color-contrast excludes hidden content).
 *
 * Nothing is hardcoded where it can be parsed: tokens + surfaces come from
 * src/app/globals.css; the landmark and dialog-focus contracts are pinned
 * against the real component sources (the Radix surfaces themselves are
 * portal-rendered client components — the repo's established pinning level,
 * cf. cli-dialog-command-set.test.ts).
 *
 * Method (identical to badge-contrast.test.ts): oklch → linear sRGB
 * (Björn Ottosson matrices) → sRGB gamma → gamma-space alpha compositing →
 * WCAG 2.1 relative-luminance ratio.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

import { restoreFocusToTrigger } from '../../src/components/wanyrix/cli-dialog'

/* ------------------------------------------------------- oklch → sRGB math -- */
/* Same math as tests/unit/badge-contrast.test.ts (Björn Ottosson matrices). */

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
const lum = ([r, g, b]: [number, number, number]): number =>
  0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (fg: [number, number, number], bg: [number, number, number]): number => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}
/** gamma-space alpha compositing — what the browser renders for `text-x/90`. */
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

const SURFACES = ['background', 'card', 'popover', 'muted', 'secondary', 'sidebar', 'accent'] as const
type Surface = (typeof SURFACES)[number]
type Theme = 'light' | 'dark'

function themeBlock(theme: Theme): string {
  return cssBlock(globalsCss, theme === 'light' ? ':root' : '\\.dark')
}

function surfaceSrgb(theme: Theme, name: Surface): [number, number, number] {
  const { L, C, H } = oklchVar(themeBlock(theme), name)
  return oklchToSrgb(L, C, H)
}

function mutedFgSrgb(theme: Theme): [number, number, number] {
  const { L, C, H } = oklchVar(themeBlock(theme), 'muted-foreground')
  return oklchToSrgb(L, C, H)
}

/* ------------------------------------------------------------------ suite -- */

describe('muted-foreground token — WCAG AA (≥ 4.5:1) on every theme surface (issue #131)', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const surface of SURFACES) {
      test(`${theme} · full-opacity token on --${surface}`, () => {
        const r = ratio(mutedFgSrgb(theme), surfaceSrgb(theme, surface))
        expect(r).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  test('both themes keep the warm hue family (no blue/indigo drift)', () => {
    // hue 60/70: the rust/amber neutrals of the Wanyrix identity (issue #43).
    // A hue drift toward blue/indigo (250–310) would break the design system.
    for (const theme of ['light', 'dark'] as const) {
      const { C, H } = oklchVar(themeBlock(theme), 'muted-foreground')
      expect(C).toBeLessThan(0.05) // muted stays a near-neutral
      expect(H).toBeGreaterThanOrEqual(0)
      expect(H).toBeLessThanOrEqual(90) // warm quadrant — never blue/indigo
    }
  })

  test('token retune is pinned: light rgb(100,88,80), dark rgb(171,163,155)', () => {
    // Regression pin for the #131 values. A future token change must re-run
    // this math (and re-verify the /90 step below), not silently regress.
    expect(mutedFgSrgb('light')).toEqual([100, 88, 80])
    expect(mutedFgSrgb('dark')).toEqual([171, 163, 155])
  })

  test('light token improved or held vs the pre-#131 value on every surface', () => {
    const before = oklchToSrgb(0.5, 0.015, 65) // oklch(0.5 0.015 65) — M10 token
    for (const surface of SURFACES) {
      const bg = surfaceSrgb('light', surface)
      expect(ratio(mutedFgSrgb('light'), bg)).toBeGreaterThanOrEqual(ratio(before, bg) - 0.01)
    }
  })

  test('dark token improved or held vs the pre-#131 value on every surface', () => {
    const before = oklchToSrgb(0.68, 0.012, 70) // oklch(0.68 0.012 70) — M10 token
    for (const surface of SURFACES) {
      const bg = surfaceSrgb('dark', surface)
      expect(ratio(mutedFgSrgb('dark'), bg)).toBeGreaterThanOrEqual(ratio(before, bg) - 0.01)
    }
  })
})

describe('the /90 step — the sweep contract (#131 raised text-muted-foreground/<n> text to /90)', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const surface of SURFACES) {
      test(`${theme} · text-muted-foreground/90 composited over --${surface} ≥ 4.5:1`, () => {
        const r = ratio(comp(mutedFgSrgb(theme), 0.9, surfaceSrgb(theme, surface)), surfaceSrgb(theme, surface))
        expect(r).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  test('sub-/90 steps really were failing in light (the confirmed axe class)', () => {
    // The M10 confirmed violations: /70-ish muted text over light chrome.
    // This pins WHY the sweep was needed — do not weaken without re-running axe.
    for (const step of [0.6, 0.7, 0.75, 0.8]) {
      const r = ratio(comp(mutedFgSrgb('light'), step, surfaceSrgb('light', 'card')), surfaceSrgb('light', 'card'))
      expect(r).toBeLessThan(4.5)
    }
  })

  test('no text usage of text-muted-foreground below /90 remains (aria-hidden decorations exempt)', () => {
    // Walk the component sources: any `text-muted-foreground/<n>` class on a
    // TEXT node must be ≥ 90. Dimmer steps are allowed only on aria-hidden
    // elements (axe color-contrast excludes hidden content) or pure icons.
    const collect = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f)
        return statSync(p).isDirectory() ? collect(p) : p.endsWith('.tsx') ? [p] : []
      })
    const offenders: string[] = []
    for (const file of collect(join(ROOT, 'src', 'components'))) {
      const src = readFileSync(file, 'utf8')
      const re = /text-muted-foreground\/(\d+)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        const step = Number(m[1])
        if (step >= 90) continue
        // the class may dim an aria-hidden element (icon/label) — allowed.
        // aria-hidden can sit on a later line of the opening JSX tag, so scan
        // to the tag's closing '>' rather than just the className line.
        const tagEnd = src.indexOf('>', m.index)
        const openingTag = src.slice(m.index, tagEnd === -1 ? m.index + 200 : tagEnd)
        if (openingTag.includes('aria-hidden')) continue
        offenders.push(`${file.replace(ROOT + '/', '')}: …${src.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ')}…`)
      }
    }
    expect(offenders).toEqual([])
  })
})

/* ------------------------------------------------------- landmark contract -- */

describe('region landmark — CommandDialog renders its accessible name inside DialogContent (#131)', () => {
  const commandTsx = readFileSync(join(ROOT, 'src', 'components', 'ui', 'command.tsx'), 'utf8')

  test('DialogHeader (sr-only title/description) lives INSIDE DialogContent', () => {
    const contentOpen = commandTsx.indexOf('<DialogContent')
    const headerOpen = commandTsx.indexOf('<DialogHeader')
    const contentClose = commandTsx.indexOf('</DialogContent>')
    expect(contentOpen).toBeGreaterThanOrEqual(0)
    expect(headerOpen).toBeGreaterThan(contentOpen)
    expect(contentClose).toBeGreaterThan(headerOpen)
  })

  test('the header keeps sr-only + title/description (dialog naming intact)', () => {
    expect(commandTsx).toMatch(/<DialogHeader className="sr-only">/)
    expect(commandTsx).toMatch(/<DialogTitle>\{title\}<\/DialogTitle>/)
    expect(commandTsx).toMatch(/<DialogDescription>\{description\}<\/DialogDescription>/)
  })
})

/* --------------------------------------------- dialog focus restoration -- */

describe('CLI-contract dialog focus restoration (#131)', () => {
  const cliDialogTsx = readFileSync(join(ROOT, 'src', 'components', 'wanyrix', 'cli-dialog.tsx'), 'utf8')
  const appShellTsx = readFileSync(join(ROOT, 'src', 'components', 'wanyrix', 'app-shell.tsx'), 'utf8')

  test('DialogContent wires onCloseAutoFocus → restoreFocusToTrigger(triggerRef.current)', () => {
    expect(cliDialogTsx).toMatch(/onCloseAutoFocus=\{\(event\) => restoreFocusToTrigger\(event, triggerRef\?\.current\)\}/)
  })

  test('app-shell hands the sidebar "view CLI contract" button to the dialog as the trigger', () => {
    // the invoking control carries the ref…
    expect(appShellTsx).toMatch(/<button\s*\n\s*ref=\{cliTriggerRef\}/)
    // …and the dialog receives it (every close path lands focus there).
    expect(appShellTsx).toMatch(/<CliContractDialog open=\{cliOpen\} onOpenChange=\{setCliOpen\} triggerRef=\{cliTriggerRef\} \/>/)
  })

  test('restoreFocusToTrigger: connected trigger → preventDefault + focus', () => {
    const calls: string[] = []
    const event = { preventDefault: () => calls.push('preventDefault') } as unknown as Event
    const trigger = {
      isConnected: true,
      focus: () => calls.push('focus'),
    } as unknown as HTMLElement
    restoreFocusToTrigger(event, trigger)
    expect(calls).toEqual(['preventDefault', 'focus'])
  })

  test('restoreFocusToTrigger: disconnected/unmounted trigger does nothing (Radix default stands)', () => {
    const calls: string[] = []
    const event = { preventDefault: () => calls.push('preventDefault') } as unknown as Event
    const trigger = {
      isConnected: false,
      focus: () => calls.push('focus'),
    } as unknown as HTMLElement
    restoreFocusToTrigger(event, trigger)
    restoreFocusToTrigger(event, null)
    restoreFocusToTrigger(event, undefined)
    expect(calls).toEqual([])
  })
})

/* --------------------------------------------- issue #144 a11y batch pins -- */

describe('modal dialog semantics — aria-modal on both primitives (#144)', () => {
  const sheetTsx = readFileSync(join(ROOT, 'src', 'components', 'ui', 'sheet.tsx'), 'utf8')
  const dialogTsx = readFileSync(join(ROOT, 'src', 'components', 'ui', 'dialog.tsx'), 'utf8')

  test('SheetContent announces aria-modal (Radix 1.1.15 omits it)', () => {
    expect(sheetTsx).toMatch(/<SheetPrimitive\.Content\s+data-slot="sheet-content"\s+(?:\/\*[\s\S]*?\*\/\s*)?aria-modal=\{true\}/)
  })

  test('DialogContent announces aria-modal (Radix 1.1.15 omits it)', () => {
    expect(dialogTsx).toMatch(/<DialogPrimitive\.Content\s+data-slot="dialog-content"\s+(?:\/\*[\s\S]*?\*\/\s*)?aria-modal=\{true\}/)
  })

  test('the 16px ✕ close controls carry hit-44 (44×44 touch target)', () => {
    expect(sheetTsx).toMatch(/<SheetPrimitive\.Close className="hit-44 /)
    expect(dialogTsx).toMatch(/className="hit-44 ring-offset-background/)
  })
})

describe('finding + diff-queue sheets restore focus to their invoking control (#144 D-2)', () => {
  for (const name of ['finding-sheet', 'diff-queue-sheet']) {
    const tsx = readFileSync(join(ROOT, 'src', 'components', 'wanyrix', `${name}.tsx`), 'utf8')

    test(`${name}: captures the invoking element on open (onOpenAutoFocus)`, () => {
      expect(tsx).toMatch(/onOpenAutoFocus=\{\(\) => \{[\s\S]*?invokeRef\.current = document\.activeElement/)
    })

    test(`${name}: restores it on every close path (onCloseAutoFocus)`, () => {
      expect(tsx).toMatch(/onCloseAutoFocus=\{\(event\) => restoreFocusToTrigger\(event, invokeRef\.current\)\}/)
    })
  }
})

describe('wayfinding captions — the /60 label variant is gone (#144 D-3)', () => {
  const appShellTsx = readFileSync(join(ROOT, 'src', 'components', 'wanyrix', 'app-shell.tsx'), 'utf8')

  test('no text-muted-foreground/60 usage remains in app-shell (mobile nav captions use the full token)', () => {
    // The full token measures 8.0:1 on the dark chrome (canvas-measured) vs the
    // /60 composite at 3.46:1 — the confirmed axe/QA failure class.
    expect(appShellTsx).not.toMatch(/text-muted-foreground\/60/)
  })

  test('the mobile nav caption class is pinned to the full token', () => {
    expect(appShellTsx).toMatch(
      /font-mono text-\[9px\] uppercase tracking-\[0\.15em\] text-muted-foreground"/,
    )
  })
})

describe('icon-only controls carry the 44px hit-area contract (#144 D-5)', () => {
  // Every interactive ICON-ONLY control in the topbar/panels resolves to a
  // ≥44×44 effective hit area via the `.hit-44` pseudo-element utility
  // (visual size preserved). The live census is re-measured in the browser;
  // these source pins keep the named controls from regressing.
  for (const rel of [
    'wanyrix/system-status-pill.tsx',
    'wanyrix/cli-dialog.tsx',
    'wanyrix/change-intelligence-panel.tsx',
    'wanyrix/scan-history.tsx',
    'wanyrix/views/experiments-view.tsx',
  ]) {
    test(`${rel} uses hit-44`, () => {
      const src = readFileSync(join(ROOT, 'src', 'components', rel), 'utf8')
      expect(src).toMatch(/hit-44/)
    })
  }
})
