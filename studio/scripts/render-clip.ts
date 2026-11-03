/**
 * `pnpm render-clip <project> --from 4:47 --to 5:47 [--label option2]`
 *
 * Cuts a window of the source, removes pauses, burns captions in program time, and
 * writes a reviewable MP4. This is the T0 path: no browser, no model, one ffmpeg run.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Transcript } from '@dsh-video/core'
import { chinAt, detectFaces, detectSilence, projectPaths, refineWordTimings } from '../packages/host-ingest/src/index.js'
import { compactSelectExpr, compactWindow, DEFAULT_CYRILLIC_CAPTION_STYLE, planCaptionPages, shiftWords, toAss, voicePolishChain } from '../packages/host-render/src/index.js'

const argv = process.argv.slice(2)
const slug = argv.find((a) => !a.startsWith('--'))
if (slug === undefined) { console.error('usage: pnpm render-clip <project> --from 4:47 --to 5:47 [--label name]'); process.exit(2) }
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
const mmss = (v: string) => { const [m, s] = v.split(':'); return (Math.round(Number(m) * 60 + Number(s))) * 1000 }
const fromMs = mmss(opt('from', '0:00')!)
const toMs = mmss(opt('to', '0:45')!)
const label = opt('label', 'clip')!
const withCaptions = !argv.includes('--no-captions')
const captionMode = (opt('captions', 'phrase') as 'none' | 'word' | 'phrase')

const paths = projectPaths(resolve('projects', slug))
const record = JSON.parse(await readFile(paths.record, 'utf8'))
const src = record.sources[0]
const proxy: string = src.proxies.preview
if (!existsSync(proxy)) { console.error(`missing preview proxy: ${proxy}`); process.exit(2) }

const raw = Transcript.parse(JSON.parse(await readFile(join(paths.analysis, `transcript.${src.id}.json`), 'utf8')))
const silence = await detectSilence(src.proxies.audio, src.id)
const { transcript } = refineWordTimings(raw, silence, src.durationMs)

// --- program time ---------------------------------------------------------
const win = compactWindow(silence, fromMs, toMs, { pauseMs: 250 })
const words = shiftWords(transcript.words, win, fromMs, toMs)
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', proxy], { encoding: 'utf8' })
const [W, H] = probe.stdout.trim().split(',').map(Number) as [number, number]

console.log(`\nrendering ${label}: ${opt('from')} → ${opt('to')} (source window ${((toMs - fromMs) / 1000).toFixed(1)}s)`)
console.log(`  kept ${win.regions.length} speech regions · removed ${(win.removedMs / 1000).toFixed(1)}s of pause · program ${(win.programDurationMs / 1000).toFixed(1)}s`)

// --- faces → one stable caption baseline for the whole clip --------------
const faces = await detectFaces({ proxyPath: proxy, analysisDir: paths.analysis, srcId: src.id })
const gapPx = Math.round(H * 0.045)
const bottomSafe = Math.round(H * 0.97)

// Median chin across the pages actually being shown (source time), not per frame: a
// per-frame chin makes captions bob with the speaker's head, and — worse — makes the font
// size differ between pages, which reads as a defect.
const srcForProgram = (progMs: number): number => {
  for (const r of win.regions) {
    const len = r.srcEndMs - r.srcStartMs
    if (progMs >= r.progStartMs && progMs < r.progStartMs + len) return r.srcStartMs + (progMs - r.progStartMs)
  }
  return win.regions[win.regions.length - 1]!.srcEndMs
}
const chins = faces.samples
  .filter((s) => s.face !== undefined)
  .map((s) => ({ atMs: s.atMs, chinY: s.face!.chinY }))
  .filter((s) => {
    const prog = s.atMs
    return prog >= fromMs && prog < toMs
  })
  .map((s) => s.chinY)
  .sort((a, b) => a - b)
const medianChin = chins.length === 0 ? Math.round(H * 0.78) : Math.round(chins[Math.floor(chins.length / 2)]!)
const topPx = Math.min(medianChin + gapPx, Math.round(H * 0.82))

// --- captions -------------------------------------------------------------
// One size for every page. The word-by-word read is one line, so the size is bounded by
// the band below the chin; the phrase read also runs one line and takes fewer words instead
// of shrinking.
const bandPx = bottomSafe - topPx
const maxSizeForBand = Math.floor(bandPx / 1.18)
const baseSize = Math.round(H * (captionMode === 'word' ? 0.165 : 0.115))
const style = {
  ...DEFAULT_CYRILLIC_CAPTION_STYLE,
  sizePx: Math.min(baseSize, maxSizeForBand),
  karaoke: captionMode,
  maxLines: 1,
}
console.log(`  faces: ${chins.length} samples · median chin ${medianChin}px · captions at y=${topPx} · band ${bandPx}px · font ${style.sizePx}px`)

const pages = planCaptionPages(words, {
  frameWidth: W,
  style,
  targetWordsPerPage: captionMode === 'word' ? 1 : 3,
  place: { topPx, maxBottomPx: bottomSafe },
})
void srcForProgram

const assPath = join(paths.render, `${label}.ass`)
// ffmpeg's filtergraph parser treats the path literally, but a workspace path with
// spaces is a recurring source of "Invalid argument" — the burn copy lives in /tmp.
const burnAssPath = `/tmp/dsh-${slug}-${label}.ass`
await mkdir(paths.render, { recursive: true })
await writeFile(assPath, toAss(pages, { width: W, height: H, style }))
await writeFile(burnAssPath, toAss(pages, { width: W, height: H, style }))
console.log(`  ${words.length} words → ${pages.length} caption pages (${(words.length / pages.length).toFixed(1)} words/page)`)

// --- render -------------------------------------------------------------
const outDir = resolve('out')
await mkdir(outDir, { recursive: true })
const outPath = join(outDir, `${slug}-${label}.mp4`)
const sel = compactSelectExpr(win)
const voice = voicePolishChain()
console.log(`  voice: ${voice.description}`)
// loudnorm normalises AUDIO; burning captions is a VIDEO filter. Keeping them on their
// own streams is not stylistic — mixing them up is an ffmpeg error.
// The proxy is video-only on purpose: audio is extracted separately for ASR and mixing,
// so every render pairs the video proxy (input 0) with the 48 kHz audio master (input 1).
// Both share the source timeline, so one between() expression addresses both.
const filter = [
  `[0:v]select='${sel}',setpts=N/FRAME_RATE/TB${withCaptions ? `,ass=${burnAssPath}:fontsdir=${style.fontDir}` : ''}[outv]`,
  `[1:a]aselect='${sel}',asetpts=N/SR/TB,${voice.filters}[outa]`,
].join(';')

const started = Date.now()
const r = spawnSync('ffmpeg', [
  '-hide_banner', '-v', 'error', '-y', '-i', proxy, '-i', src.proxies.audio,
  '-filter_complex', filter, '-map', '[outv]', '-map', '[outa]',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', outPath,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
if (r.status !== 0) { console.error('ffmpeg failed:\n' + (r.stderr || '').slice(-1500)); process.exit(1) }

const wall = (Date.now() - started) / 1000
const info = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,width,height', '-of', 'json', outPath], { encoding: 'utf8' })
const meta = JSON.parse(info.stdout)
const v = meta.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
console.log(`\n  ✔ ${outPath}`)
console.log(`    ${v.width}x${v.height} · ${Number(meta.format.duration).toFixed(2)}s · ${(Number(meta.format.size) / 1024 ** 2).toFixed(1)} MB · rendered in ${wall.toFixed(1)}s`)
console.log(`    captions: ${assPath}`)
