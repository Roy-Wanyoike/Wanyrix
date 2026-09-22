#!/usr/bin/env node
/**
 * Wanyrix brand asset generator.
 *
 * Source of truth: src/components/wanyrix/logo.tsx (the "Beacon W" mark).
 * This script rasterizes that geometry into every raster deliverable:
 *
 *   src/app/apple-icon.png          180×180  iOS home-screen icon (full bleed)
 *   public/og.png                  1200×630  OpenGraph / social card
 *   public/brand/banner.png        1344×768  README hero banner
 *   public/brand/wanyrix-mark-512.png 512²  transparent-corner mark for docs
 *
 * Rerun after any mark tweak:  node scripts/generate-brand-assets.mjs
 * Requires: sharp (already a project dependency).
 */

import sharp from 'sharp'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(process.cwd())
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const BACKDROP = '/tmp/brand/og-backdrop.png'
const HERO = path.join(ROOT, 'public/brand/hero.png')
if (!existsSync(HERO)) fail(`missing ${HERO} — regenerate with the z-ai CLI first`)

mkdirSync(path.join(ROOT, 'public/brand'), { recursive: true })
mkdirSync(path.join(ROOT, 'src/app'), { recursive: true })

// ---------------------------------------------------------------------------
// Mark geometry — mirror of logo.tsx (32×32 viewBox). Keep in sync.
// ---------------------------------------------------------------------------
const GRADIENT = `
    <linearGradient id="wbg" x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f59e0b"/>
      <stop offset="0.5" stop-color="#ea580c"/>
      <stop offset="1" stop-color="#9a3412"/>
    </linearGradient>`

/** Beacon-W group, 32×32 user units, to be wrapped in a transform. */
function markGroup({ rx = 8.5, plate = true } = {}) {
  return `
  <g>
    ${plate ? `<rect x="0" y="0" width="32" height="32" rx="${rx}" fill="url(#wbg)"/>` : ''}
    ${
      plate
        ? `<rect x="0.5" y="0.5" width="31" height="31" rx="${rx - 0.5}" fill="none" stroke="oklch(1 0 0 / 22%)" stroke-width="1"/>`
        : ''
    }
    <circle cx="16" cy="6.7" r="1.85" fill="white" fill-opacity="0.95"/>
    <path d="M7.7 12.1 L11.85 22.9 L16 10.6 L20.15 22.9 L24.3 12.1"
      stroke="white" stroke-opacity="0.96" stroke-width="2.7"
      stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>`
}

function svgDoc(width, height, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${inner}</svg>`
}

async function renderPng(svg, outPath) {
  const buf = await sharp(Buffer.from(svg)).png().toBuffer()
  writeFileSync(outPath, buf)
  console.log(`✓ ${path.relative(ROOT, outPath)} (${buf.length} bytes)`)
  return buf
}

// ---------------------------------------------------------------------------
// 1. apple-icon.png — 180×180 full-bleed (iOS applies its own corner mask)
// ---------------------------------------------------------------------------
async function appleIcon() {
  const size = 180
  const s = size / 32
  const svg = svgDoc(
    size,
    size,
    `<defs>${GRADIENT}</defs><g transform="scale(${s})">${markGroup({ rx: 0 })}</g>`,
  )
  await renderPng(svg, path.join(ROOT, 'src/app/apple-icon.png'))
}

// ---------------------------------------------------------------------------
// 2. public/brand/wanyrix-mark-512.png — transparent-corner mark for docs
// ---------------------------------------------------------------------------
async function mark512() {
  const size = 512
  const s = size / 32
  const svg = svgDoc(size, size, `<defs>${GRADIENT}</defs><g transform="scale(${s})">${markGroup()}</g>`)
  await renderPng(svg, path.join(ROOT, 'public/brand/wanyrix-mark-512.png'))
}

// ---------------------------------------------------------------------------
// 3. public/og.png — 1200×630 social card (backdrop + scrim + lockup)
// ---------------------------------------------------------------------------
async function ogImage() {
  if (!existsSync(BACKDROP)) fail(`missing ${BACKDROP} — regenerate with the z-ai CLI first`)
  const W = 1200
  const H = 630
  const overlay = svgDoc(
    W,
    H,
    `
    <defs>${GRADIENT}
      <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#0c0a08" stop-opacity="0.96"/>
        <stop offset="0.48" stop-color="#0c0a08" stop-opacity="0.78"/>
        <stop offset="1" stop-color="#0c0a08" stop-opacity="0.30"/>
      </linearGradient>
      <linearGradient id="footscrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.62" stop-color="#0c0a08" stop-opacity="0"/>
        <stop offset="1" stop-color="#0c0a08" stop-opacity="0.85"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#scrim)"/>
    <rect width="${W}" height="${H}" fill="url(#footscrim)"/>
    <g transform="translate(76,84) scale(4.75)">${markGroup()}</g>
    <text x="74" y="372" font-family="DejaVu Sans" font-weight="bold" font-size="92"
      fill="#ffffff" letter-spacing="1">Wanyrix</text>
    <rect x="78" y="396" width="150" height="5" rx="2.5" fill="#fbbf24"/>
    <text x="76" y="452" font-family="DejaVu Sans" font-size="33" fill="#e7e5e4"
      letter-spacing="0.5">Engineering Intelligence for Rust</text>
    <text x="76" y="562" font-family="DejaVu Sans Mono" font-size="23" fill="#a8a29e"
      letter-spacing="0.5">local-first · evidence-grounded · cargo-native</text>
  `,
  )
  const base = await sharp(BACKDROP).resize(W, H, { fit: 'cover', position: 'centre' }).toBuffer()
  const buf = await sharp(base).composite([{ input: Buffer.from(overlay) }]).png().toBuffer()
  writeFileSync(path.join(ROOT, 'public/og.png'), buf)
  console.log(`✓ public/og.png (${buf.length} bytes)`)
}

// ---------------------------------------------------------------------------
// 4. public/brand/banner.png — README hero (art + left scrim + lockup)
// ---------------------------------------------------------------------------
async function banner() {
  const W = 1344
  const H = 768
  const overlay = svgDoc(
    W,
    H,
    `
    <defs>${GRADIENT}
      <linearGradient id="bscrim" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#0a0807" stop-opacity="0.92"/>
        <stop offset="0.42" stop-color="#0a0807" stop-opacity="0.62"/>
        <stop offset="0.78" stop-color="#0a0807" stop-opacity="0.06"/>
        <stop offset="1" stop-color="#0a0807" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bscrim)"/>
    <g transform="translate(88,88) scale(3.4)">${markGroup()}</g>
    <text x="86" y="436" font-family="DejaVu Sans" font-weight="bold" font-size="104"
      fill="#ffffff" letter-spacing="1">Wanyrix</text>
    <rect x="90" y="462" width="176" height="6" rx="3" fill="#fbbf24"/>
    <text x="86" y="528" font-family="DejaVu Sans Mono" font-size="34" fill="#fbbf24"
      letter-spacing="2">engineering intelligence</text>
    <text x="86" y="586" font-family="DejaVu Sans" font-size="26" fill="#d6d3d1"
      letter-spacing="0.4">Understand your Rust codebase — grounded in evidence.</text>
  `,
  )
  const buf = await sharp(HERO).composite([{ input: Buffer.from(overlay) }]).png().toBuffer()
  writeFileSync(path.join(ROOT, 'public/brand/banner.png'), buf)
  console.log(`✓ public/brand/banner.png (${buf.length} bytes)`)
}

const jobs = { appleIcon, mark512, ogImage, banner }
const only = process.argv[2]
if (only && jobs[only]) {
  await jobs[only]()
} else {
  for (const job of Object.values(jobs)) await job()
}
console.log('brand assets done')
