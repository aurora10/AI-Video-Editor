/**
 * `pnpm qa-transcript <project>` — does the transcript hold up against the audio?
 *
 * Word-level timestamps from a hosted ASR are not automatically trustworthy: they can be
 * contiguous subdivisions of a segment rather than acoustically aligned words, and they can
 * drift into silence. Captions built on drifted timing put text over dead air, which is the
 * single most visible failure in short-form video. This check makes that measurable.
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Transcript } from '@dsh-video/core'
import { detectSilence, projectPaths } from '../packages/host-ingest/src/index.js'

const slug = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (slug === undefined) { console.error('usage: pnpm qa-transcript <project-slug>'); process.exit(2) }

const paths = projectPaths(resolve('projects', slug))
const record = JSON.parse(await readFile(paths.record, 'utf8'))
const src = record.sources[0]
const useRefined = process.argv.includes('--refined')
const file = join(paths.analysis, `transcript.${src.id}${useRefined ? '.refined' : ''}.json`)
const t = Transcript.parse(JSON.parse(await readFile(file, 'utf8')))
const silence = await detectSilence(src.proxies.audio, src.id)

const gaps = t.words.slice(1).map((w, i) => w.startMs - t.words[i]!.endMs)
const closed = silence.regions.filter((r) => r.endMs > 0)
const silenceMs = closed.reduce((n, r) => n + (r.endMs - r.startMs), 0)
const speechMs = src.durationMs - silenceMs
const wordMs = t.words.reduce((n, w) => n + (w.endMs - w.startMs), 0)
const drifted = t.words.filter((w) => {
  const mid = (w.startMs + w.endMs) / 2
  return closed.some((r) => mid > r.startMs && mid < r.endMs)
})
const scripts = { cyrillic: 0, latin: 0, other: 0 }
for (const w of t.words) {
  if (/[\u0400-\u04FF]/.test(w.text)) scripts.cyrillic++
  else if (/[A-Za-z]/.test(w.text)) scripts.latin++
  else scripts.other++
}
const wpm = Math.round((t.words.length / (wordMs / 60_000)))
const longWords = [...t.words].sort((a, b) => b.text.length - a.text.length).slice(0, 3).map((w) => `${w.text} (${w.text.length})`)

const verdict = (ok: boolean, text: string) => `${ok ? '✔' : '✘'} ${text}`
console.log(`\ntranscript QA — ${slug} · ${t.words.length} words · ${t.model} · ${t.language}${useRefined ? ' · REFINED' : ''}\n`)
console.log(verdict(wordMs / speechMs > 0.85, `word coverage of detected speech: ${(wordMs / speechMs * 100).toFixed(1)}% (${(wordMs / 1000).toFixed(1)}s of ${(speechMs / 1000).toFixed(1)}s)`))
console.log(verdict(drifted.length / t.words.length < 0.02, `words drifting into silence: ${drifted.length} (${(drifted.length / t.words.length * 100).toFixed(1)}%)`))
console.log(verdict(gaps.filter((g) => g === 0).length / gaps.length < 0.6, `contiguous word timestamps: ${gaps.filter((g) => g === 0).length}/${gaps.length} gaps are exactly 0 ms`))
console.log(`  speaking rate: ${wpm} words/min · real pauses >400 ms: ${gaps.filter((g) => g > 400).length}`)
console.log(`  script: ${JSON.stringify(scripts)} · longest words: ${longWords.join(', ')}`)
console.log('\nreading of these numbers:')
if (gaps.filter((g) => g === 0).length / gaps.length >= 0.6) {
  console.log('  ! Word timings are contiguous subdivisions, not acoustic alignment. Karaoke is safe;')
  console.log('    per-word isolation and "does this word land on speech start" are not. A refinement')
  console.log('    pass (VAD-guided redistribution inside each segment) is required before word-pop presets.')
}
if (drifted.length / t.words.length >= 0.02) {
  console.log(`  ! ${drifted.length} words sit inside detected silence: caption pages built blindly on these`)
  console.log('    will show text over dead air. Snap caption spans to the silence map.')
}
if (scripts.cyrillic > 0) {
  console.log('  ! Cyrillic content: presets need a Cyrillic-capable font, and pages must be fitted by')
  console.log('    measured width — "4 words per page" overflows on words like the ones listed above.')
}
console.log()
