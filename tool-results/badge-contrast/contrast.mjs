// ENG-TCB-2 contrast verification — WCAG 2.1 math for the Wanyrix honesty badges.
// Method (matches the QA record): oklch → sRGB, gamma-space alpha compositing of the
// badge background over the theme card, WCAG relative-luminance ratio.
// Run: node contrast.mjs  (or bun contrast.mjs)

// --- oklch -> sRGB ----------------------------------------------------------
function oklchToLinearSrgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
const gamma = (c) =>
  (c <= 0.00031306858 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055)
const toSrgb = (lin) => lin.map((c) => Math.round(255 * Math.min(1, Math.max(0, gamma(c)))))
function oklch(L, C, H) { return toSrgb(oklchToLinearSrgb(L, C, H)) } // -> [r,g,b] 0..255

// --- WCAG 2.1 ---------------------------------------------------------------
const lin = (v8) => { const c = v8 / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (fg, bg) => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}
// gamma-space alpha compositing (what the browser renders for bg-X/10 over a card)
const comp = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)))
const hex = ([r, g, b]) => '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')

// --- theme surfaces (from src/app/globals.css) ------------------------------
const cardLight = oklch(0.995, 0.003, 85)
const cardDark = oklch(0.18, 0.006, 60)
const bgLight = oklch(0.977, 0.005, 85)

// --- tailwind v4 palette (node_modules/tailwindcss/theme.css) ---------------
const P = {
  red300: oklch(0.808, 0.114, 19.571), red400: oklch(0.704, 0.191, 22.216), red500: oklch(0.637, 0.237, 25.331),
  red700: oklch(0.505, 0.213, 27.518), red800: oklch(0.444, 0.177, 26.899),
  orange300: oklch(0.837, 0.128, 66.29), orange500: oklch(0.705, 0.213, 47.604),
  orange700: oklch(0.553, 0.195, 38.402), orange800: oklch(0.47, 0.157, 37.304),
  amber400: oklch(0.828, 0.189, 84.429), amber500: oklch(0.769, 0.188, 70.08),
  amber700: oklch(0.555, 0.163, 48.998), amber800: oklch(0.473, 0.137, 46.201),
  emerald200: oklch(0.905, 0.093, 164.15), emerald300: oklch(0.845, 0.143, 164.978),
  emerald500: oklch(0.696, 0.17, 162.48), emerald700: oklch(0.508, 0.118, 165.612),
  emerald800: oklch(0.432, 0.095, 166.913),
  teal300: oklch(0.855, 0.138, 181.071), teal500: oklch(0.704, 0.14, 182.503),
  teal700: oklch(0.511, 0.096, 186.391), teal800: oklch(0.437, 0.078, 188.216),
}

function show(name, fg, bg, fgName, bgName) {
  const r = ratio(fg, bg)
  console.log(
    `${r >= 4.5 ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(6)}:1  ${name.padEnd(44)} fg=${fgName}(${hex(fg)}) bg=${bgName}(${hex(bg)})`,
  )
  return r
}

// A badge = text color over (tint of TINTC at alpha over card surface)
function badge(label, fg, fgName, tintC, tintName, alpha, card, cardName) {
  return show(`${label} [${cardName}]`, fg, comp(tintC, alpha, card), fgName, `${tintName}/${alpha * 100}%+${cardName}`)
}

console.log('================ CURRENT (light card ' + hex(cardLight) + ') ================')
badge('MEASURED  text-emerald-300', P.emerald300, 'emerald-300', P.emerald500, 'emerald-500', 0.10, cardLight, 'card-light')
badge('ESTIMATED text-orange-300', P.orange300, 'orange-300', P.orange500, 'orange-500', 0.10, cardLight, 'card-light')
badge('HIGH      text-teal-300', P.teal300, 'teal-300', P.teal500, 'teal-500', 0.10, cardLight, 'card-light')
badge('VERIFIED  text-emerald-200', P.emerald200, 'emerald-200', P.emerald500, 'emerald-500', 0.20, cardLight, 'card-light')
badge('warning   text-amber-400', P.amber400, 'amber-400', P.amber500, 'amber-500', 0.10, cardLight, 'card-light')
badge('critical  text-red-400', P.red400, 'red-400', P.red500, 'red-500', 0.10, cardLight, 'card-light')
badge('delta-bad text-red-300', P.red300, 'red-300', P.red500, 'red-500', 0.10, cardLight, 'card-light')

console.log('================ CANDIDATES (light card) ================')
badge('MEASURED  emerald-700', P.emerald700, 'emerald-700', P.emerald500, 'emerald-500', 0.10, cardLight, 'card-light')
badge('MEASURED  emerald-800', P.emerald800, 'emerald-800', P.emerald500, 'emerald-500', 0.10, cardLight, 'card-light')
badge('VERIFIED  emerald-800 @20%', P.emerald800, 'emerald-800', P.emerald500, 'emerald-500', 0.20, cardLight, 'card-light')
badge('ESTIMATED orange-700', P.orange700, 'orange-700', P.orange500, 'orange-500', 0.10, cardLight, 'card-light')
badge('HIGH      teal-700', P.teal700, 'teal-700', P.teal500, 'teal-500', 0.10, cardLight, 'card-light')
badge('warning   amber-700', P.amber700, 'amber-700', P.amber500, 'amber-500', 0.10, cardLight, 'card-light')
badge('warning   amber-800', P.amber800, 'amber-800', P.amber500, 'amber-500', 0.10, cardLight, 'card-light')
badge('critical  red-700', P.red700, 'red-700', P.red500, 'red-500', 0.10, cardLight, 'card-light')
badge('delta-bad red-700', P.red700, 'red-700', P.red500, 'red-500', 0.10, cardLight, 'card-light')
badge('delta-good emerald-700', P.emerald700, 'emerald-700', P.emerald500, 'emerald-500', 0.10, cardLight, 'card-light')

console.log('================ DARK (card ' + hex(cardDark) + ') — keep 300/400 shades ================')
badge('MEASURED  text-emerald-300', P.emerald300, 'emerald-300', P.emerald500, 'emerald-500', 0.10, cardDark, 'card-dark')
badge('ESTIMATED text-orange-300', P.orange300, 'orange-300', P.orange500, 'orange-500', 0.10, cardDark, 'card-dark')
badge('HIGH      text-teal-300', P.teal300, 'teal-300', P.teal500, 'teal-500', 0.10, cardDark, 'card-dark')
badge('VERIFIED  text-emerald-200', P.emerald200, 'emerald-200', P.emerald500, 'emerald-500', 0.20, cardDark, 'card-dark')
badge('warning   text-amber-400', P.amber400, 'amber-400', P.amber500, 'amber-500', 0.10, cardDark, 'card-dark')
badge('critical  text-red-400', P.red400, 'red-400', P.red500, 'red-500', 0.10, cardDark, 'card-dark')

console.log('================ robustness: candidates on page background (light ' + hex(bgLight) + ') ================')
badge('emerald-700 on page bg', P.emerald700, 'emerald-700', P.emerald500, 'emerald-500', 0.10, bgLight, 'bg-light')
badge('orange-700 on page bg', P.orange700, 'orange-700', P.orange500, 'orange-500', 0.10, bgLight, 'bg-light')
badge('teal-700 on page bg', P.teal700, 'teal-700', P.teal500, 'teal-500', 0.10, bgLight, 'bg-light')
badge('amber-700 on page bg', P.amber700, 'amber-700', P.amber500, 'amber-500', 0.10, bgLight, 'bg-light')
badge('red-700 on page bg', P.red700, 'red-700', P.red500, 'red-500', 0.10, bgLight, 'bg-light')

console.log('================ level-800 on page bg (SectionHeading badges sit there) ================')
badge('emerald-800 on page bg @10%', P.emerald800, 'emerald-800', P.emerald500, 'emerald-500', 0.10, bgLight, 'bg-light')
badge('emerald-800 on page bg @20%', P.emerald800, 'emerald-800', P.emerald500, 'emerald-500', 0.20, bgLight, 'bg-light')
badge('orange-800 on page bg', P.orange800, 'orange-800', P.orange500, 'orange-500', 0.10, bgLight, 'bg-light')
badge('teal-800 on page bg', P.teal800, 'teal-800', P.teal500, 'teal-500', 0.10, bgLight, 'bg-light')
badge('amber-800 on page bg', P.amber800, 'amber-800', P.amber500, 'amber-500', 0.10, bgLight, 'bg-light')
badge('red-800 on page bg', P.red800, 'red-800', P.red500, 'red-500', 0.10, bgLight, 'bg-light')
badge('orange-800 on card', P.orange800, 'orange-800', P.orange500, 'orange-500', 0.10, cardLight, 'card-light')
badge('teal-800 on card', P.teal800, 'teal-800', P.teal500, 'teal-500', 0.10, cardLight, 'card-light')
