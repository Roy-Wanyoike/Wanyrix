// Task 3-b verification artifact — prints the computed WCAG ratios from the
// same parsers the unit test uses, side-by-side with the round-2 QA record
// (tool-results/badge-contrast/contrast.mjs). bun tool-results/task-3b-debug/ratios.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/home/z/my-project'
function oklchToLinearSrgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}
const gamma = (c) => (c <= 0.00031306858 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055)
const toSrgb = (l) => l.map((c) => Math.round(255 * Math.min(1, Math.max(0, gamma(c)))))
const ok = (L, C, H) => toSrgb(oklchToLinearSrgb(L, C, H))
const lin = (v8) => { const c = v8 / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (fg, bg) => { const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05) }
const comp = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)))

function parsePalette(css) {
  const map = new Map()
  const re = /--color-([a-z]+-\d+):\s*oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)[^)]*\)/g
  let m
  while ((m = re.exec(css)) !== null) map.set(m[1], { L: Number.parseFloat(m[2]) / (m[3] === '%' ? 100 : 1), C: Number.parseFloat(m[4]), H: Number.parseFloat(m[5]) })
  return map
}
function cssBlock(css, sel) { return css.match(new RegExp(sel + '\\s*\\{([^}]*)\\}'))[1] }
function oklchVar(block, name) {
  const parts = block.match(new RegExp('--' + name + ':\\s*oklch\\(\\s*([^)]+)\\)'))[1].trim().split(/\s+/)
  return { L: parts[0].endsWith('%') ? Number.parseFloat(parts[0]) / 100 : Number.parseFloat(parts[0]), C: Number.parseFloat(parts[1]), H: Number.parseFloat(parts[2]) }
}

const palette = parsePalette(readFileSync(join(ROOT, 'node_modules', 'tailwindcss', 'theme.css'), 'utf8'))
const globalsCss = readFileSync(join(ROOT, 'src', 'app', 'globals.css'), 'utf8')
const cardL = ok(...Object.values(oklchVar(cssBlock(globalsCss, ':root'), 'card')))
const cardD = ok(...Object.values(oklchVar(cssBlock(globalsCss, '\\.dark'), 'card')))

const P = (k) => palette.get(k)
const srgb = (k) => ok(P(k).L, P(k).C, P(k).H)
const pair = (fg, tint, a, card) => ratio(srgb(fg), comp(srgb(tint), a, card))

console.log('light card (QA record → computed):')
console.log('  measured emerald-800 :', pair('emerald-800', 'emerald-500', 0.1, cardL).toFixed(2), '(QA 6.84)')
console.log('  estimated orange-800 :', pair('orange-800', 'orange-500', 0.1, cardL).toFixed(2), '(QA 6.51)')
console.log('  high      teal-800   :', pair('teal-800', 'teal-500', 0.1, cardL).toFixed(2), '(QA 6.75)')
console.log('  warning   amber-800  :', pair('amber-800', 'amber-500', 0.1, cardL).toFixed(2), '(QA 6.46)')
console.log('  critical  red-800    :', pair('red-800', 'red-500', 0.1, cardL).toFixed(2), '(QA ~7.3)')
console.log('  verified  emerald-800@20%:', pair('emerald-800', 'emerald-500', 0.2, cardL).toFixed(2), '(QA 6.20)')
console.log('dark card:')
console.log('  measured emerald-300 :', pair('emerald-300', 'emerald-500', 0.1, cardD).toFixed(2), '(QA range 6.00–11.17)')
console.log('  critical  red-400    :', pair('red-400', 'red-500', 0.1, cardD).toFixed(2))
