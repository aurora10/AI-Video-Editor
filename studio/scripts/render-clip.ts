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
import { compactSelectExpr, compactWindow, DEFAULT_CYRILLIC_CAPTION_STYLE, fitSizePx, planCaptionPages, planGraphics, resolveFont, shiftWords, toAss, voicePolishChain } from '../packages/host-render/src/index.js'
import { EMPTY_GRAPHICS, GraphicsTrack } from '@dsh-video/core'

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
if (win.regions.length === 0) {
  console.error(`no speech survived in ${opt('from')}–${opt('to')}: the window is empty, reversed, or entirely pause`)
  process.exit(2)
}
const words = shiftWords(transcript.words, win, fromMs, toMs)
const orientation = (opt('orientation', 'horizontal') as 'horizontal' | 'vertical')
const background = (opt('background', 'none') as 'none' | 'blur' | 'studio')
/** Vertical + a background treatment means "fit the whole frame", not "crop a strip out of it". */
const wantsFill = orientation === 'vertical' && background !== 'none'
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
// How source pixels land in the delivered frame. Two treatments, one mapping:
//   crop  — fill the canvas, discarding the sides (sx from the crop width)
//   fill  — fit the whole frame and pad with blur (uniform scale + centring offsets)
// Getting this wrong is subtle and silent: captions were placed with the crop mapping while the
// frame was actually fitted, which put them ~190px lower than intended.
const fitScale = Math.min(W / SRC_W, H / SRC_H)
const transform = wantsFill
  ? { sx: fitScale, sy: fitScale, ox: (W - SRC_W * fitScale) / 2, oy: (H - SRC_H * fitScale) / 2 }
  : { sx: W / (orientation === 'vertical' ? cropW : SRC_W), sy: H / SRC_H, ox: orientation === 'vertical' ? -cropX * (W / cropW) : 0, oy: 0 }
const medianChin = Math.round(transform.oy + medianChinSrc * transform.sy)
const topPx = Math.min(medianChin + gapPx, Math.round(H * 0.82))

// --- captions -------------------------------------------------------------
// One size for every page. The word-by-word read is one line, so the size is bounded by
// the band below the chin; the phrase read also runs one line and takes fewer words instead
// of shrinking.
const bandPx = bottomSafe - topPx
const maxSizeForBand = Math.floor(bandPx / 1.18)
const baseSize = Math.round(H * (captionMode === 'word' ? 0.165 : 0.115))
// Two limits: the band below the chin, and the horizontal budget.
//
// The width limit is taken from the 90th-percentile word, not the longest. Sizing for the single
// longest word (15 letters here) collapsed the type from 158px to 65px for every caption in the
// clip; sizing for the typical word keeps the intended look and lets `planCaptionPages` shrink
// only the rare page that would otherwise overflow. A long word occasionally being a little
// smaller is ordinary typography; every word being small is a bad result.
const sizes = words.map((w) => w.text.length).sort((a, b) => a - b)
const typicalLength = sizes.length === 0 ? 0 : sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * 0.9))]!
const typicalWord = 'Х'.repeat(Math.max(4, typicalLength))
const probeStyle = { ...DEFAULT_CYRILLIC_CAPTION_STYLE, fontFamily: font.family, fontDir: font.dir, sizePx: baseSize }
const maxSizeForWidth = fitSizePx(typicalWord, probeStyle, W * DEFAULT_CYRILLIC_CAPTION_STYLE.maxWidthPct)
const style = {
  ...DEFAULT_CYRILLIC_CAPTION_STYLE,
  fontFamily: font.family,
  fontDir: font.dir,
  sizePx: Math.max(16, Math.min(baseSize, maxSizeForBand, maxSizeForWidth)),
  karaoke: captionMode,
  maxLines: 1,
}
console.log(`  faces: ${chins.length} samples · median chin ${medianChinSrc}px(source) · captions at y=${topPx} · band ${bandPx}px · font ${font.entry.label} ${style.sizePx}px`)
if (orientation === 'vertical') {
  console.log(wantsFill
    ? `  reframe: ${W}x${H} · full frame fitted over a blurred self-background (${background}), no cropping`
    : `  reframe: ${W}x${H} · crop ${cropW}x${SRC_H} at x=${cropX} (median face x ${Math.round(medianFaceX)})`)
}

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
const noVoice = argv.includes('--no-voice-polish')
const voice = noVoice
  ? { filters: 'anull', description: 'raw audio (voice polish off)' }
  : voicePolishChain()
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
// A grade is only meaningful as a *frame treatment*; for the fill case it applies to the
// composited result, for the plain case to the frame itself.
const gradeChain = background === 'studio' ? ['eq=brightness=-0.06:saturation=0.82', 'vignette=PI/5'] : []

// ---- graphics plan -------------------------------------------------------
// Composited between the frame treatment and the captions: a graphic may sit under a caption,
// but a caption must never be dimmed by a grade (an earlier version applied the studio grade
// after the burn and greyed the type out).
const graphicsPath = join(paths.edit, 'graphics.json')
const graphicsTrack: GraphicsTrack = existsSync(graphicsPath)
  ? GraphicsTrack.parse(JSON.parse(await readFile(graphicsPath, 'utf8')))
  : EMPTY_GRAPHICS
const graphicsRequested = opt('graphics', 'on') !== 'off'
const graphicsOn = graphicsRequested && graphicsTrack.graphics.length > 0
console.log(graphicsOn
  ? `  graphics: ${graphicsTrack.graphics.length} item(s) from edit/graphics.json`
  : `  graphics: none${existsSync(graphicsPath) ? ' (edit/graphics.json has no items)' : ' (no edit/graphics.json)'}`)

const gplan = graphicsOn
  ? planGraphics(graphicsTrack, 'vgbase', {
      width: W,
      height: H,
      fontFamily: font.family,
      fontDir: font.dir,
    })
  : { extraInputs: [] as string[], statements: [] as string[], textAss: null as string | null, finalLabel: 'vgbase' }

const graphicsAssPath = gplan.textAss === null ? null : `/tmp/dsh-${slug}-${label}-graphics.ass`
if (graphicsAssPath !== null && gplan.textAss !== null) await writeFile(graphicsAssPath, gplan.textAss)

// ---- filter graph --------------------------------------------------------
let filter: string
// Stage order is deliberate: frame treatment → graphics → captions → encode.
// Each optional stage is a list entry, so an absent one leaves no dangling comma.
const afterGraphicsLabel = gplan.finalLabel
const finalStage = [
  'null',
  ...(graphicsAssPath === null ? [] : [`ass=${graphicsAssPath}:fontsdir=${font.dir}`]),
  ...(withCaptions ? [`ass=${burnAssPath}:fontsdir=${style.fontDir}`] : []),
]
const finalChain = finalStage.length === 1 ? '' : `,${finalStage.slice(1).join(',')}`

let base: string[]
if (wantsFill) {
  // Fit the WHOLE frame and fill the remainder with a blurred copy of itself. Cropping a 9:16
  // window out of 16:9 keeps only ~32% of the frame width; on a seated talking head that loses
  // the room and half the gesture. A blurred self-background needs no subject matte, so it
  // cannot produce halos around hair or hands.
  const blurSigma = background === 'studio' ? 42 : 28
  const graded = [...gradeChain, 'format=yuv420p'].join(',')
  base = [
    `[0:v]select='${sel}',setpts=N/FRAME_RATE/TB,split=2[bg][fg]`,
    `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=${blurSigma},eq=brightness=-0.18:saturation=0.55[bgv]`,
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[fgs]`,
    `[bgv][fgs]overlay=(W-w)/2:(H-h)/2,${graded}[vgbase]`,
  ]
} else {
  const chain = [
    `select='${sel}'`,
    'setpts=N/FRAME_RATE/TB',
    ...(orientation === 'vertical' ? [`crop=${cropW}:${SRC_H}:${cropX}:0`, `scale=${W}:${H}:flags=lanczos`] : []),
    ...gradeChain,
  ]
  base = [`[0:v]${chain.join(',')}[vgbase]`]
}

filter = [
  ...base,
  ...gplan.statements,
  `[${afterGraphicsLabel}]null${finalChain}[outv]`,
  `[1:a]aselect='${sel}',asetpts=N/SR/TB,${voice.filters}[outa]`,
].join(';')

const started = Date.now()
const r = spawnSync('ffmpeg', [
  '-hide_banner', '-v', 'error', '-y', '-i', proxy, '-i', src.proxies.audio, ...gplan.extraInputs,
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
  transform,
  treatment: wantsFill
    ? `fill+${background}`
    : `${orientation === 'vertical' ? 'crop' : 'plain'}${gradeChain.length > 0 ? `+${background}` : ''}`,
  backgroundApplied: wantsFill || gradeChain.length > 0,
  captions: withCaptions ? { topPx, fontPx: style.sizePx, mode: captionMode, font: font.entry.key } : null,
  pace, pauseRetainMs: PAUSE_RETAIN[pace],
  voicePolish: !noVoice,
  programMs: win.programDurationMs,
}, null, 2) + '\n')

const wall = (Date.now() - started) / 1000
const info = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,width,height', '-of', 'json', outPath], { encoding: 'utf8' })
const meta = JSON.parse(info.stdout)
const v = meta.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
console.log(`\n  ✔ ${outPath}`)
console.log(`    ${v.width}x${v.height} · ${Number(meta.format.duration).toFixed(2)}s · ${(Number(meta.format.size) / 1024 ** 2).toFixed(1)} MB · rendered in ${wall.toFixed(1)}s`)
console.log(`    captions: ${assPath}\n    geometry: ${metaPath}`)
