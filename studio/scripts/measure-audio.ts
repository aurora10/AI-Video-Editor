/**
 * `pnpm measure-audio <file>...` — spectral balance of speech, before/after processing.
 *
 * Prints the band deltas relative to the mid band and a verdict. This is how "the sound is
 * not deep" becomes a target: body 80–160 Hz and presence 1–3 kHz are the two bands that
 * decide whether a voice reads thin and dull.
 */
import { spawnSync } from 'node:child_process'

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (files.length === 0) { console.error('usage: pnpm measure-audio <file> [...]'); process.exit(2) }

const BANDS: [string, number, number][] = [
  ['sub 40–80', 40, 80], ['body 80–160', 80, 160], ['low-mid 160–400', 160, 400],
  ['mid 400–1k', 400, 1000], ['presence 1–3k', 1000, 3000], ['sib 5–8k', 5000, 8000], ['air 8–12k', 8000, 12000],
]

function meanDb(file: string, lo: number, hi: number): number | null {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af',
    `highpass=f=${lo},lowpass=f=${hi},volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' })
  const m = /mean_volume:\s*(-?[\d.]+)/.exec(r.stderr)
  return m?.[1] === undefined ? null : Number(m[1])
}

for (const file of files) {
  const vals = BANDS.map(([name, lo, hi]) => [name, meanDb(file, lo, hi)] as const)
  const mid = vals.find(([n]) => n.startsWith('mid'))?.[1] ?? null
  console.log(`\n  ${file}`)
  for (const [name, v] of vals) {
    if (v === null) continue
    const delta = mid === null ? 0 : v - mid
    console.log(`    ${name.padEnd(18)} ${v.toFixed(1).padStart(7)} dB   Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`)
  }
  const body = vals.find(([n]) => n.startsWith('body'))?.[1]
  const pres = vals.find(([n]) => n.startsWith('presence'))?.[1]
  if (body != null && pres != null && mid != null) {
    const bodyDelta = body - mid
    const presDelta = pres - mid
    const thin = bodyDelta < -6
    const dull = presDelta < -2
    console.log(`    → body ${bodyDelta.toFixed(1)} dB, presence ${presDelta.toFixed(1)} dB · ${thin ? 'THIN' : 'body ok'} / ${dull ? 'DULL' : 'clarity ok'}`)
  }
}
console.log()
