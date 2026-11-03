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
import { compactSelectExpr, compactWindow, DEFAULT_CYRILLIC_CAPTION_STYLE, planCaptionPages, resolveFont, shiftWords, toAss, voicePolishChain } from '../packages/host-render/src/index.js'

const argv = process.argv.slice(2)
const slug = argv.find((a) => !a.startsWith('--'))
if (slug === undefined) { console.error('usage: pnpm render-clip <project> --from 4:47 --to 5:47 [--label name]'); process.exit(2) }
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
const mmss = (v: string) => { const [m, s] = v.split(':'); return (Math.round(Number(m) * 60 + Number(s))) * 1000 }
const fromMs = mmss(opt('from', '0:00')!)
const toMs = mmss(opt('to', '0:45')!)
const label = opt('label', 'clip')!
const withCaptions = !argv.includes('--no-captions')
const captionMode = (opt('captions', 'word') as 'none' | 'word' | 'phrase')
const fontKey = opt('font', 'inter')!
const font = resolveFont(fontKey)

const paths = projectPaths(resolve('projects', slug))
const record = JSON.parse(await readFile(paths.record, 'utf8'))
const src = record.sources[0]
const proxy: string = src.proxies.preview
if (!existsSync(proxy)) { console.error(`missing preview proxy: ${proxy}`); process.exit(2) }

const raw = Transcript.parse(JSON.parse(await readFile(join(paths.analysis, `transcript.${src.id}.json`), 'utf8')))
const silence = await detectSilence(src.proxies.audio, src.id)
const { transcript } = refineWordTimings(raw, silence, src.durationMs)

// --- program time ---------------------------------------------------------
const pace = opt('pace', 'normal') as 'calm' | 'normal' | 'fast'
// Measured on the reference cut: 0 ms reads as rushed jump cuts; ~220 ms lets a thought land.
const PAUSE_RETAIN: Record<typeof pace, number> = { fast: 0, normal: 80, calm: 220 }
const win = compactWindow(silence, fromMs, toMs, { pauseMs: 250, pauseRetainMs: PAUSE_RETAIN[pace] })
const words = shiftWords(transcript.words, win, fromMs, toMs)
const orientation = (opt('orientation', 'horizontal') as 'horizontal' | 'vertical')
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', proxy], { encoding: 'utf8' })
const [SRC_W, SRC_H] = probe.stdout.trim().split(',').map(Number) as [number, number]
// Vertical preview: 9:16 at the same pixel budget as the 540p landscape preview.
const W = orientation === 'vertical' ? 540 : SRC_W
const H = orientation === 'vertical' ? 960 : SRC_H

console.log(`\nrendering ${label}: ${opt('from')} → ${opt('to')} (source window ${((toMs - fromMs) / 1000).toFixed(1)}s)`)
console.log(`  kept ${win.regions.length} speech regions · removed ${(win.removedMs / 1000).toFixed(1)}s of pause · program ${(win.programDurationMs / 1000).toFixed(1)}s`)

// --- faces → one stable caption baseline for the whole clip --------------
const faces = await detectFaces({ proxyPath: proxy, analysisDir: paths.analysis, srcId: src.id })
const gapPx = Math.round((orientation === 'vertical' ? 960 : H) * 0.045)
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
const medianChinSrc = chins.length === 0 ? Math.round(SRC_H * 0.78) : Math.round(chins[Math.floor(chins.length / 2)]!)

// Vertical reframe: crop a 9:16 window out of the landscape frame, centred on the MEDIAN face
// position rather than chasing every frame. On a single-shot talking head the subject does not
// cross the frame, so a stable window avoids the swim that per-frame tracking produces.
const cropW = orientation === 'vertical' ? Math.round((SRC_H * 9) / 16 / 2) * 2 : SRC_W
const faceCenters = faces.samples
  .filter((s) => s.face !== undefined)
  .map((s) => s.face!.x + s.face!.w / 2)
  .sort((a, b) => a - b)
const medianFaceX = faceCenters.length === 0 ? SRC_W / 2 : faceCenters[Math.floor(faceCenters.length / 2)]!
const cropX = orientation === 'vertical'
  ? Math.max(0, Math.min(Math.round(medianFaceX - cropW / 2), SRC_W - cropW))
  : 0
// Cropping keeps full height and the scale is uniform in y, so the chin maps by the height ratio.
const medianChin = Math.round(medianChinSrc * (H / SRC_H))
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
  fontFamily: font.family,
  fontDir: font.dir,
  sizePx: Math.min(baseSize, maxSizeForBand),
  karaoke: captionMode,
  maxLines: 1,
}
console.log(`  faces: ${chins.length} samples · median chin ${medianChinSrc}px(source) · captions at y=${topPx} · band ${bandPx}px · font ${font.entry.label} ${style.sizePx}px`)
if (orientation === 'vertical') console.log(`  reframe: ${W}x${H} · crop ${cropW}x${SRC_H} at x=${cropX} (median face x ${Math.round(medianFaceX)})`)

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
void H
console.log(`  voice: ${voice.description}`)
// loudnorm normalises AUDIO; burning captions is a VIDEO filter. Keeping them on their
// own streams is not stylistic — mixing them up is an ffmpeg error.
// The proxy is video-only on purpose: audio is extracted separately for ASR and mixing,
// so every render pairs the video proxy (input 0) with the 48 kHz audio master (input 1).
// Both share the source timeline, so one between() expression addresses both.
// Build the video chain as a list and join it: string-concatenating optional segments left a
// dangling comma whenever the last one was absent (vertical + no captions), which ffmpeg
// rejects as "No such filter: ''".
const videoChain = [
  `select='${sel}'`,
  'setpts=N/FRAME_RATE/TB',
  ...(orientation === 'vertical' ? [`crop=${cropW}:${SRC_H}:${cropX}:0`, `scale=${W}:${H}:flags=lanczos`] : []),
  ...(withCaptions ? [`ass=${burnAssPath}:fontsdir=${style.fontDir}`] : []),
]
const filter = [
  `[0:v]${videoChain.join(',')}[outv]`,
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

// Geometry sidecar: anything that has to reason about this render later (verifiers, the pane,
// the future resolver) needs to know how source pixels map to output pixels. Re-deriving that
// from the filter chain is exactly how a checker ends up comparing two different coordinate
// systems and passing anyway.
const metaPath = outPath.replace(/\.mp4$/, '.meta.json')
await writeFile(metaPath, JSON.stringify({
  label, fromMs, toMs, orientation,
  source: { width: SRC_W, height: SRC_H },
  output: { width: W, height: H },
  crop: orientation === 'vertical' ? { x: cropX, w: cropW, h: SRC_H } : null,
  scale: { x: W / (orientation === 'vertical' ? cropW : SRC_W), y: H / SRC_H },
  captions: withCaptions ? { topPx, fontPx: style.sizePx, mode: captionMode, font: font.entry.key } : null,
  pace, pauseRetainMs: PAUSE_RETAIN[pace],
  voicePolish: true,
  programMs: win.programDurationMs,
}, null, 2) + '\n')

const wall = (Date.now() - started) / 1000
const info = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,width,height', '-of', 'json', outPath], { encoding: 'utf8' })
const meta = JSON.parse(info.stdout)
const v = meta.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
console.log(`\n  ✔ ${outPath}`)
console.log(`    ${v.width}x${v.height} · ${Number(meta.format.duration).toFixed(2)}s · ${(Number(meta.format.size) / 1024 ** 2).toFixed(1)} MB · rendered in ${wall.toFixed(1)}s`)
console.log(`    captions: ${assPath}\n    geometry: ${metaPath}`)
