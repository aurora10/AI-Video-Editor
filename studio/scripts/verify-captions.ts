/**
 * `pnpm verify-captions <project> [--from 4:47] [--to 5:47]`
 *
 * Renders caption pages over black and measures the *actual* bright-pixel bounding box,
 * then asserts each page stays inside the safe width and needs no more than two lines.
 * This is the check that keeps the width estimate honest — the agent cannot see images,
 * so "does it fit" has to become a number.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Transcript } from '@dsh-video/core'
import { detectSilence, projectPaths, refineWordTimings } from '../packages/host-ingest/src/index.js'
import { DEFAULT_CYRILLIC_CAPTION_STYLE, planCaptionPages, toAss } from '../packages/host-render/src/index.js'

const argv = process.argv.slice(2)
const slug = argv.find((a) => !a.startsWith('--'))
if (slug === undefined) { console.error('usage: pnpm verify-captions <project> [--from 4:47] [--to 5:47]'); process.exit(2) }
const opt = (name: string, dflt: string) => { const i = argv.indexOf(`--${name}`); return i === -1 ? dflt : argv[i + 1]! }
const mmss = (v: string) => { const [m, s] = v.split(':'); return (Number(m) * 60 + Number(s)) * 1000 }

const W = 1080, H = 1920
const paths = projectPaths(resolve('projects', slug))
const record = JSON.parse(await readFile(paths.record, 'utf8'))
const src = record.sources[0]
const raw = Transcript.parse(JSON.parse(await readFile(join(paths.analysis, `transcript.${src.id}.json`), 'utf8')))
const silence = await detectSilence(src.proxies.audio, src.id)
const { transcript } = refineWordTimings(raw, silence, src.durationMs)

const from = mmss(opt('from', '4:47'))
const to = mmss(opt('to', '5:47'))
const words = transcript.words.filter((w) => w.startMs >= from && w.endMs <= to)
const style = DEFAULT_CYRILLIC_CAPTION_STYLE
const pages = planCaptionPages(words, { frameWidth: W, style, targetWordsPerPage: 4 })

console.log(`\ncaption pages — ${slug} · ${(from / 1000).toFixed(0)}s→${(to / 1000).toFixed(0)}s · ${words.length} words → ${pages.length} pages`)
console.log(`  style: ${style.fontFamily} ${style.sizePx}px · width budget ${(W * style.maxWidthPct).toFixed(0)}px · max ${style.maxLines} lines · karaoke ${style.karaoke}\n`)

const dir = await mkdtemp(join(tmpdir(), 'caps-'))
const geometryStyle = { ...style, karaoke: 'none' as const }
const timed = pages.map((p, i) => ({ ...p, startMs: i * 1000, endMs: i * 1000 + 950 }))
const assPath = join(dir, 'caps.ass')
await writeFile(assPath, toAss(timed, { width: W, height: H, style: geometryStyle }))
// A second document keeps karaoke on, to prove the highlight actually changes pixels.
const karaokePath = join(dir, 'caps-karaoke.ass')
await writeFile(karaokePath, toAss(timed.slice(0, 1), { width: W, height: H, style }))

/** Decode a PNG's grey plane and return the bounding box of bright pixels. */
function brightBox(pngPath: string): { x0: number; x1: number; y0: number; y1: number; fill: number } {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', pngPath, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 })
  const buf = r.stdout
  if (buf.length !== W * H) throw new Error(`unexpected frame bytes ${buf.length} != ${W * H}`)
  let x0 = W, x1 = -1, y0 = H, y1 = -1, count = 0
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      if (buf[row + x]! > 128) { count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }
  return { x0, x1, y0, y1, fill: count }
}

let failures = 0
const safeX0 = W * ((1 - style.maxWidthPct) / 2)
const safeX1 = W - safeX0
for (const [i, page] of pages.slice(0, 8).entries()) {
  const png = join(dir, `p${i}.png`)
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=${pages.length + 2}`,
    '-vf', `ass=${assPath}:fontsdir=${style.fontDir}`, '-ss', String(i), '-frames:v', '1', png], { encoding: 'utf8' })
  if (r.status !== 0) { console.error('  ffmpeg failed:', r.stderr.slice(0, 300)); failures++; continue }
  const box = brightBox(png)
  if (box.x1 < 0) { console.log(`  page ${i + 1}: NO TEXT RENDERED`); failures++; continue }
  const width = box.x1 - box.x0 + 1
  const insideSafe = box.x0 >= safeX0 - 2 && box.x1 <= safeX1 + 2
  const estimated = Math.round(page.widthPx)
  const drift = Math.round(((width - estimated) / estimated) * 100)
  if (!insideSafe) failures++
  console.log(`  page ${String(i + 1).padStart(2)} ${insideSafe ? '✔' : '✘'} ${JSON.stringify(page.lines.join(' / '))}`)
  console.log(`          measured ${String(width).padStart(4)}px · estimate ${estimated}px (${drift > 0 ? '+' : ''}${drift}%) · x ${box.x0}→${box.x1} · safe ${Math.round(safeX0)}→${Math.round(safeX1)}`)
}

// --- karaoke sanity: sung vs un-sung pixels must both exist ------------------
{
  const pngEarly = join(dir, 'k-early.png')
  const pngLate = join(dir, 'k-late.png')
  for (const [offset, out] of [[0.05, pngEarly], [0.85, pngLate]] as const) {
    spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=2`,
      '-vf', `ass=${karaokePath}:fontsdir=${style.fontDir}`, '-ss', String(offset), '-frames:v', '1', out], { encoding: 'utf8' })
  }
  const early = brightBox(pngEarly)
  const late = brightBox(pngLate)
  const grew = late.fill > early.fill * 1.5
  if (!grew) failures++
  console.log(`\n  karaoke: bright pixels ${early.fill} at page start → ${late.fill} near page end ${grew ? '✔ (highlight progresses)' : '✘ (no progression)'}`)
}

const tooMany = pages.filter((p) => p.lines.length > style.maxLines).length
if (tooMany > 0) { console.log(`\n  ✘ ${tooMany} page(s) needed more than ${style.maxLines} lines`); failures++ }
const avgWords = (words.length / pages.length).toFixed(1)
console.log(`\n  pages: ${pages.length} · ${avgWords} words/page avg · ${failures === 0 ? 'ALL WITHIN SAFE AREA ✔' : `${failures} FAILURE(S) ✘`}\n`)
await rm(dir, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
