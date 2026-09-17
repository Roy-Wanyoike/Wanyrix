import type { DiffEntry } from './diff-store'

/**
 * Unified-diff .patch generator (issue #42) — turns a queued reviewable diff
 * into a `git apply`-parseable unified diff document.
 *
 * Honesty contract (Gate 19 / Gate 21):
 * - Wanyrix does NOT know the current contents of the target file, so the
 *   generator NEVER fabricates removed lines or invented context. Every entry
 *   is emitted with **new-proposal semantics** (`--- /dev/null` → a proposal
 *   document inside `wanyrix-proposals/`), exactly mirroring what the UI shows:
 *   a proposed change for human review, not a claim about the repository.
 * - The suggestion text (payload-driven) becomes the `+` lines verbatim.
 * - Header/footer comment lines carry the Gate-19 notice and the estimate
 *   (labeled as an estimate) when present.
 */

const PROPOSAL_DIR = 'wanyrix-proposals'

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'change'
  )
}

function extensionFor(kind: string): string {
  switch (kind) {
    case 'patch':
      return '.rs.patch.txt'
    case 'config':
      return '.toml.patch.txt'
    case 'command':
      return '.sh.patch.txt'
    case 'architecture':
      return '.md.patch.txt'
    default:
      return '.patch.txt'
  }
}

/** Body of the proposal document: the suggestion plus structured metadata. */
function proposalBody(e: DiffEntry): string[] {
  const lines = [
    `# wanyrix proposed change — apply manually (Gate 19: no silent modification)`,
    `# workspace: ${e.workspace}`,
    `# source:   ${e.source}`,
    `# target:   ${e.target}`,
    `# kind:     ${e.kind}`,
    ...(e.findingId ? [`# finding:  ${e.findingId}`] : []),
    `# queued:   ${new Date(e.at).toISOString()}`,
    ``,
    ...e.suggestion.split('\n'),
  ]
  if (e.estimate) {
    lines.push(``, `# estimated impact: ${e.estimate} (estimated — verify via wanyrix experiment, Gate 21)`)
  }
  lines.push(``, `# end of proposal`)
  return lines
}

function proposalFilename(e: DiffEntry): string {
  return `${PROPOSAL_DIR}/${slugify(e.title || e.target)}${extensionFor(e.kind)}`
}

/**
 * Build a unified diff for a single queued entry.
 * The emitted file is the *proposal document itself*, so the diff is a
 * genuine, parseable new-file diff of that document.
 */
export function buildUnifiedDiff(e: DiffEntry): string {
  const filename = proposalFilename(e)
  const body = proposalBody(e)

  const header = [
    `Index: ${filename}`,
    `===================================================================`,
    `--- /dev/null`,
    `+++ ${filename}`,
    `@@ -0,0 +1,${body.length} @@`,
  ]

  // `+` for every added line; blank lines stay blank (still additions, but
  // rendered without a trailing marker artifact so the file stays tidy).
  const hunk = body.map((l) => (l === '' ? '+' : `+${l}`))

  return [...header, ...hunk].join('\n') + '\n'
}

/**
 * Build a concatenated bundle for a set of entries (the "Download all" path).
 * Entries are separated by `Index:` blocks; a preamble explains how to
 * inspect/apply and repeats the Gate-19 notice, and a manifest cross-references
 * each block with its doctor finding so reviewers can trace proposals back to
 * the evidence that produced them.
 */
export function buildPatchBundle(entries: DiffEntry[]): string {
  const manifest = entries.map((e, i) => {
    const ref = e.findingId ? `finding ${e.findingId}` : `source ${e.source}`
    return `# ${i + 1}. ${proposalFilename(e)} — ${ref} — target: ${e.target}`
  })
  const preamble = [
    `# wanyrix proposed-change bundle — ${entries.length} diff${entries.length === 1 ? '' : 's'}`,
    `# generated ${new Date().toISOString()}`,
    `#`,
    `# Each block below is a self-contained unified diff describing a PROPOSAL.`,
    `# Wanyrix never modifies a repository silently (Gate 19) — review every`,
    `# block and apply manually if, and only if, the change is wanted.`,
    `# Estimates are estimates: verify via wanyrix experiment (Gate 21).`,
    `#`,
    `# manifest (block ↔ finding cross-reference):`,
    ...manifest,
    ``,
  ].join('\n')

  return preamble + entries.map((e) => buildUnifiedDiff(e)).join('\n')
}

/** Suggested download filename for a single entry. */
export function patchFilename(e: DiffEntry): string {
  return `${e.workspace}-${slugify(e.title || e.target)}.patch`
}

/** Suggested download filename for a bundle. */
export function bundleFilename(workspace: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${workspace}-proposals-${stamp}.patch`
}

/** Trigger a client-side Blob download (no network, no repo mutation). */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/x-diff;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
