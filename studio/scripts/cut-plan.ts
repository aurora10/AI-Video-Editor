/**
 * `pnpm cut-plan <project> [--target 45] [--count 3]`
 *
 * Proposes candidate cuts for a short-form video, from the transcript and the pause map
 * only — no video decoding, no model. Prints the opening words of each candidate so a
 * human can pick by ear, and writes `edit/candidates.json` for the agent to refine.
 *
 * Scoring is deliberately boring and explainable: speech density, how cleanly the ends
 * land on sentence boundaries, and how much dead air survives inside the window.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Transcript } from '@dsh-video/core'
import { detectSilence, projectPaths, refineWordTimings } from '../packages/host-ingest/src/index.js'

const argv = process.argv.slice(2)
const slug = argv.find((a) => !a.startsWith('--'))
if (slug === undefined) { console.error('usage: pnpm cut-plan <project-slug> [--target 45] [--count 3]'); process.exit(2) }
const num = (name: string, dflt: number) => { const i = argv.indexOf(`--${name}`); return i === -1 ? dflt : Number(argv[i + 1]) }
const targetSec = num('target', 45)
const count = num('count', 3)

const paths = projectPaths(resolve('projects', slug))
const record = JSON.parse(await readFile(paths.record, 'utf8'))
const src = record.sources[0]
const raw = Transcript.parse(JSON.parse(await readFile(join(paths.analysis, `transcript.${src.id}.json`), 'utf8')))
const silence = await detectSilence(src.proxies.audio, src.id)
const { transcript: t, report } = refineWordTimings(raw, silence, src.durationMs)

console.log(`\ncut planning — ${slug} · ${(src.durationMs / 1000).toFixed(0)}s source · target ${targetSec}s\n`)
console.log(`  timing refinement: ${report.movedOutOfSilence} words moved out of silence (max ${report.maxShiftMs} ms), ${report.runs} speech runs, ${report.stillInSilence} still in silence`)

// Sentence-ish boundaries: transcript segments, clamped to their words.
const boundaries = t.segments
  .map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text.trim() }))
  .filter((s) => s.text.length > 0)

interface Candidate {
  startMs: number; endMs: number; durationSec: number
  words: number; wpm: number; deadAirMs: number
  startsClean: boolean; endsClean: boolean; score: number
  openingLine: string; closingLine: string
}

const speechInside = (a: number, b: number) => {
  const dead = silence.regions.filter((r) => r.endMs > 0 && r.endMs > a && r.startMs < b)
    .reduce((n, r) => n + (Math.min(b, r.endMs) - Math.max(a, r.startMs)), 0)
  return Math.max(0, (b - a) - dead)
}

const candidates: Candidate[] = []
for (let i = 0; i < boundaries.length; i++) {
  for (let j = i; j < boundaries.length; j++) {
    const start = boundaries[i]!
    const end = boundaries[j]!
    const dur = (end.endMs - start.startMs) / 1000
    if (dur < targetSec * 0.75) continue
    if (dur > targetSec * 1.45) break
    const inWindow = t.words.filter((w) => w.startMs >= start.startMs && w.endMs <= end.endMs)
    if (inWindow.length < 40) continue
    const speechMs = speechInside(start.startMs, end.endMs)
    const deadAirMs = (end.endMs - start.startMs) - speechMs
    const wpm = (inWindow.length / (speechMs / 60_000))
    const startsClean = /^[«"A-ZА-ЯЁ]/.test(start.text)
    const endsClean = /[.!?…]$/.test(end.text)
    // density near 130-170 wpm reads well for a talking short; dead air and sloppy
    // ends cost; a clean sentence start/end earns a bonus.
    const density = 1 - Math.min(1, Math.abs(wpm - 150) / 150)
    const score = density * 0.6 + (deadAirMs / (end.endMs - start.startMs) < 0.02 ? 0.2 : 0)
      + (startsClean ? 0.1 : 0) + (endsClean ? 0.1 : 0)
    candidates.push({
      startMs: start.startMs, endMs: end.endMs, durationSec: Number(dur.toFixed(1)),
      words: inWindow.length, wpm: Math.round(wpm), deadAirMs: Math.round(deadAirMs),
      startsClean, endsClean, score: Number(score.toFixed(3)),
      openingLine: inWindow.slice(0, 14).map((w) => w.raw).join(' '),
      closingLine: inWindow.slice(-10).map((w) => w.raw).join(' '),
    })
  }
}

candidates.sort((a, b) => b.score - a.score)
const picked: Candidate[] = []
for (const c of candidates) {
  if (picked.length >= count) break
  if (picked.some((p) => c.startMs < p.endMs && c.endMs > p.startMs)) continue
  picked.push(c)
}

if (picked.length === 0) { console.log('\nno candidate window found — try a smaller --target\n'); process.exit(0) }

picked.forEach((c, n) => {
  const mm = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
  console.log(`\n  option ${n + 1} — ${mm(c.startMs)} to ${mm(c.endMs)} · ${c.durationSec}s · ${c.words} words · ${c.wpm} wpm · dead air ${(c.deadAirMs / 1000).toFixed(1)}s · score ${c.score}`)
  console.log(`    opens: "${c.openingLine}…"`)
  console.log(`    ends:  "…${c.closingLine}"`)
})

const out = {
  schemaVersion: 1,
  projectId: record.id,
  sourceId: src.id,
  targetDurationSec: targetSec,
  generatedAt: new Date().toISOString(),
  refinement: report,
  candidates: picked.map((c, n) => ({ id: `cand-${n + 1}`, ...c })),
}
await writeFile(join(paths.edit, 'candidates.json'), JSON.stringify(out, null, 2) + '\n')
await writeFile(join(paths.analysis, `transcript.${src.id}.refined.json`), JSON.stringify(t, null, 1) + '\n')
console.log(`\n  → ${join(paths.edit, 'candidates.json')}\n  → ${join(paths.analysis, `transcript.${src.id}.refined.json`)}\n`)
