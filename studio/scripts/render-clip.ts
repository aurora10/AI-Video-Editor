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
import { chinAt, detectFaces, detectSilence, projectPaths, refineWordTimings, run } from '../packages/host-ingest/src/index.js'
import { applyNotes, compactSelectExpr, compactWindow, DEFAULT_CYRILLIC_CAPTION_STYLE, fitSizePx, planCaptionPages, planGraphics, resolveFont, shiftWords, toAss, voicePolishChain } from '../packages/host-render/src/index.js'
import { CutPlan, EMPTY_GRAPHICS, GraphicsTrack, Note, decisionFor, detectMumbles, totalCutMs } from '@dsh-video/core'

const argv = process.argv.slice(2)
const slug = argv.find((a) => !a.startsWith('--'))
if (slug === undefined) { console.error('usage: pnpm render-clip <project> --from 4:47 --to 5:47 [--label name]'); process.exit(2) }
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
// Accepts both "m:ss" (how a human says it) and plain seconds (how the server computes it).
// The server passing "410.62" into an m:ss-only parser produced NaN, an empty window, and — only
// because of the fail-fast added earlier — an error instead of a nonsense render.
const parseTimeMs = (v: string): number => {
  const text = v.trim()
  if (text.includes(':')) {
    const [m, s] = text.split(':')
    return Math.round((Number(m) * 60 + Number(s)) * 1000)
  }
  return Math.round(Number(text) * 1000)
}
const fromMs = parseTimeMs(opt('from', '0:00')!)
const toMs = parseTimeMs(opt('to', '0:45')!)
const label = opt('label', 'clip')!
if (Number.isNaN(parseTimeMs(opt('from', '0:00')!)) || Number.isNaN(parseTimeMs(opt('to', '0:45')!))) {
  console.error(`bad --from/--to: use m:ss or seconds (got "${opt('from')}" and "${opt('to')}")`)
  process.exit(2)
}
const paths = projectPaths(resolve('projects', slug))
const record = JSON.parse(await readFile(paths.record, 'utf8'))

// A shell render should look like the project, not like the built-in defaults. The agent says
// "render the window" and must get the look the user already chose; before this, a bare
// `pnpm render-clip test-vid --from …` silently produced a horizontal, un-graded cut of a vertical
// project and then recorded that as the latest render. Explicit flags still win over the record.
const stored = (record.settings ?? {}) as {
  captions?: boolean; captionStyle?: string; font?: string; pace?: string
  mumbles?: string; orientation?: string; background?: string; graphics?: string
}
const withCaptions = argv.includes('--captions')
  ? true
  : argv.includes('--no-captions')
    ? false
    : stored.captions ?? true
const captionMode = (opt('captions', stored.captionStyle === 'plain' ? 'none' : stored.captionStyle ?? 'word') as 'none' | 'word' | 'phrase')
const fontKey = opt('font', stored.font ?? 'inter')!
const font = resolveFont(fontKey)

const src = record.sources[0]
const proxy: string = src.proxies.preview
if (!existsSync(proxy)) { console.error(`missing preview proxy: ${proxy}`); process.exit(2) }

const raw = Transcript.parse(JSON.parse(await readFile(join(paths.analysis, `transcript.${src.id}.json`), 'utf8')))
const silence = await detectSilence(src.proxies.audio, src.id)
const { transcript } = refineWordTimings(raw, silence, src.durationMs)

// --- program time ---------------------------------------------------------
const pace = opt('pace', stored.pace ?? 'normal') as 'calm' | 'normal' | 'fast'
// Measured on the reference cut: 0 ms reads as rushed jump cuts; ~220 ms lets a thought land.
const PAUSE_RETAIN: Record<typeof pace, number> = { fast: 0, normal: 80, calm: 220 }
// Mumbles: sound with no words, hesitations, isolated discourse markers, false starts.
const fillersMode = opt('fillers', stored.mumbles ?? 'cut') as 'cut' | 'keep'
const mumbles = fillersMode === 'cut'
  ? detectMumbles(transcript.words, silence, src.durationMs)
    .filter((c) => c.endMs > fromMs && c.startMs < toMs)
  : []
if (fillersMode === 'cut') {
  const byReason = mumbles.reduce<Record<string, number>>((acc, c) => {
    acc[c.reason] = (acc[c.reason] ?? 0) + (c.endMs - c.startMs)
    return acc
  }, {})
  console.log(`  mumbles: ${mumbles.length} cut(s), ${(totalCutMs(mumbles) / 1000).toFixed(1)}s — ` +
    Object.entries(byReason).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(' · '))
} else {
  console.log('  mumbles: kept (--fillers keep)')
}
// --- timeline notes -------------------------------------------------------
const notesPath = join(paths.edit, 'notes.jsonl')
const storedNotes: Note[] = existsSync(notesPath)
  ? (await readFile(notesPath, 'utf8')).split('\n').filter((l) => l.trim() !== '').map((l) => Note.parse(JSON.parse(l)))
  : []

// An editorial cut plan, when one exists, decides retention per pause; the pace setting is the
// fallback for pauses the plan does not mention.
const planPath = join(paths.edit, 'cut-plan.json')
const cutPlan: CutPlan | null = existsSync(planPath)
  ? CutPlan.parse(JSON.parse(await readFile(planPath, 'utf8')))
  : null
if (cutPlan !== null) {
  const kinds = cutPlan.decisions.reduce<Record<string, number>>((a, d) => { a[d.kind] = (a[d.kind] ?? 0) + 1; return a }, {})
  console.log(`  cut plan: ${cutPlan.decisions.length} decisions by ${cutPlan.planner} — ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
}

const win = compactWindow(silence, fromMs, toMs, {
  pauseMs: 250,
  pauseRetainMs: PAUSE_RETAIN[pace],
  ...(cutPlan === null ? {} : { pauseRetainOverride: (pauseSrcMs: number) => decisionFor(cutPlan, pauseSrcMs)?.retainMs }),
  extraCuts: [
    ...mumbles.map((c) => [c.startMs, c.endMs] as [number, number]),
    // a 'cut this' note is a hand-placed removal, evaluated before the program is built
    ...storedNotes.filter((n) => n.kind === 'cut' && n.status !== 'done').map((n) => [n.srcStartMs, n.srcEndMs] as [number, number]),
  ],
})
if (win.regions.length === 0) {
  console.error(`no speech survived in ${opt('from')}–${opt('to')}: the window is empty, reversed, or entirely pause`)
  process.exit(2)
}
const words = shiftWords(transcript.words, win, fromMs, toMs)

const orientation = (opt('orientation', stored.orientation ?? 'horizontal') as 'horizontal' | 'vertical')
const background = (opt('background', stored.background ?? 'none') as 'none' | 'blur' | 'studio')
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
// Safety percentile, not the median. Within one window the speaker can sit lower and closer
// (measured on the 6:50–7:43 window: chin ranged 389–463 px against a 416 median), and a median
// baseline put captions on the face for the frames where the head was lowest. p90 clears almost
// every frame while keeping one fixed position and one fixed size.
const medianChinSrc = chins.length === 0
  ? Math.round(SRC_H * 0.78)
  : Math.round(chins[Math.min(chins.length - 1, Math.floor(chins.length * 0.9))]!)

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

// --- notes → instructions -------------------------------------------------
// Everything except 'cut' is mapped onto the program timeline here; 'cut' already went into the
// window above, because a cut changes the timeline everything else is measured against.
// "next to me": place an image on whichever side the speaker's face is furthest from, using the
// face track rather than a fixed corner. The face sits at medianFaceX of the source frame; if the
// speaker is right of centre, the empty space is on the left.
const faceSideRight = medianFaceX > SRC_W / 2
const imageLayout: 'inset-tl' | 'inset-tr' = faceSideRight ? 'inset-tl' : 'inset-tr'
const applied = applyNotes(storedNotes, win, { imageLayout, imageWidthPct: 32 })
if (storedNotes.length > 0) {
  console.log(`  notes: ${storedNotes.length} stored · ${applied.cutCount} cut · ${applied.captionSuppressed.length} hide-captions · ${applied.graphics.length} graphics · ${applied.unhandled.length} for the agent`)
}
for (const n of applied.unhandled) console.log(`    · needs the agent: "${n.text.slice(0, 70)}"`)


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

// A 'no captions here' note removes the pages that overlap its program range, so the supplied
// page plan is filtered before it is written.
const rawPages = planCaptionPages(words, {
  frameWidth: W,
  style,
  targetWordsPerPage: captionMode === 'word' ? 1 : 3,
  place: { topPx, maxBottomPx: bottomSafe },
})
const pages = rawPages.filter((p) => !applied.captionSuppressed.some(([a, b]) => p.startMs < b && p.endMs > a))
if (rawPages.length !== pages.length) {
  console.log(`  captions: ${rawPages.length - pages.length} page(s) suppressed by notes`)
}
// A surviving page may not hold across a suppressed range: the hold exists to stop the screen
// blinking between pages, not to paint over a window the user cleared.
for (const page of pages) {
  const stopsAt = applied.captionSuppressed
    .filter(([a]) => a > page.startMs)
    .reduce<number | undefined>((best, [a]) => (best === undefined || a < best ? a : best), undefined)
  if (stopsAt !== undefined) page.holdUntilMs = stopsAt
}
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
// Control renders (--no-captions) exist to be compared against, never to be watched. They go to
// their own folder, because the pane used to pick the newest file in `out/` and showed a
// caption-less control as if it were the result.
const outDir = resolve('out', withCaptions ? '' : 'controls')
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
// Subtle on purpose: the first version darkened the frame so much the owner asked why it was black.
const gradeChain = background === 'studio' ? ['eq=brightness=0.02:saturation=0.95', 'vignette=PI/8'] : []

// ---- graphics plan -------------------------------------------------------
// Composited between the frame treatment and the captions: a graphic may sit under a caption,
// but a caption must never be dimmed by a grade (an earlier version applied the studio grade
// after the burn and greyed the type out).
const graphicsPath = join(paths.edit, 'graphics.json')
const graphicsTrack: GraphicsTrack = existsSync(graphicsPath)
  ? GraphicsTrack.parse(JSON.parse(await readFile(graphicsPath, 'utf8')))
  : EMPTY_GRAPHICS
const graphicsRequested = opt('graphics', stored.graphics === 'none' || stored.graphics === 'off' ? 'off' : 'on') !== 'off'
// Notes can contribute graphics of their own (a text card, an image inset), so the track is the
// file's items plus the notes' items, and the log says which is which.
const combinedGraphics: GraphicsTrack = { schemaVersion: 1, graphics: [...graphicsTrack.graphics, ...applied.graphics] }
const graphicsAny = combinedGraphics.graphics.length > 0
const graphicsOn = graphicsRequested && graphicsAny
console.log(graphicsAny && graphicsRequested
  ? `  graphics: ${combinedGraphics.graphics.length} item(s) (${graphicsTrack.graphics.length} from edit/graphics.json, ${applied.graphics.length} from notes)`
  : '  graphics: none')
const gplan = graphicsAny && graphicsRequested
  ? planGraphics(combinedGraphics, 'vgbase', {
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
    `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=${blurSigma},eq=brightness=0.04:saturation=0.85[bgv]`,
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
// Stream progress: the pane's log box is the only feedback during a render, and a silent minute
// reads as a hang. `-progress pipe:1` gives a frame counter we can turn into a percentage.
const expectedSeconds = win.programDurationMs / 1000
let lastPct = -10
const renderExit = await run('ffmpeg', [
  '-hide_banner', '-v', 'error', '-y', '-i', proxy, '-i', src.proxies.audio, ...gplan.extraInputs,
  '-filter_complex', filter, '-map', '[outv]', '-map', '[outa]',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart',
  '-progress', 'pipe:1', '-nostats', outPath,
], {
  onProgress: (doneSeconds: number) => {
    const pct = Math.min(99, Math.floor((doneSeconds / Math.max(1, expectedSeconds)) * 100 / 10) * 10)
    if (pct > lastPct) { lastPct = pct; console.log(`  …encoding ${pct}%`) }
  },
}).then(() => 0).catch((error: unknown) => { console.error(String(error)); return 1 })
if (renderExit !== 0) { console.error('ffmpeg failed'); process.exit(1) }

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
  pace, pauseRetainMs: PAUSE_RETAIN[pace], cutPlan: cutPlan === null ? null : cutPlan.decisions.length,
  voicePolish: !noVoice,
  programMs: win.programDurationMs,
  // Source↔program map. The pane authors notes against program time; the server converts them to
  // source time with this table so a later re-cut cannot move a note to another sentence.
  regions: win.regions.map((r) => ({ srcStartMs: r.srcStartMs, srcEndMs: r.srcEndMs, progStartMs: r.progStartMs })),
}, null, 2) + '\n')

// The pane authors notes in program time and the server needs the map to convert them, so the
// region table is published next to the render artifacts.
await writeFile(join(paths.render, 'regions.json'), JSON.stringify({
  label, fromMs, toMs, programMs: win.programDurationMs,
  regions: win.regions.map((r) => ({ srcStartMs: r.srcStartMs, srcEndMs: r.srcEndMs, progStartMs: r.progStartMs })),
}, null, 2) + '\n')

const wall = (Date.now() - started) / 1000
const info = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,width,height', '-of', 'json', outPath], { encoding: 'utf8' })
const meta = JSON.parse(info.stdout)
const v = meta.streams.find((s: { codec_type: string }) => s.codec_type === 'video')

// A render made by the agent has to become "the latest render" the pane shows. Only the pane's own
// render route used to record `lastRender`, so anything rendered from the shell left the pane on an
// older file — the agent says "here is your cut" and the user watches the previous one.
// Control renders are excluded by construction (they land in `out/controls/`), because a
// caption-less control must never be presented as the result.
if (withCaptions) {
  try {
    const fresh = JSON.parse(await readFile(paths.record, 'utf8'))
    fresh.lastRender = {
      file: `${slug}-${label}.mp4`,
      label,
      at: new Date().toISOString(),
      captions: true,
      settings: {
        captions: true,
        captionStyle: captionMode,
        font: font.entry.key,
        voicePolish: !noVoice,
        pace,
        mumbles: fillersMode,
        orientation,
        background,
        graphics: graphicsRequested ? 'broll' : 'off',
      },
    }
    await writeFile(paths.record, JSON.stringify(fresh, null, 2) + '\n')
    console.log(`    pane: this is now the latest render`)
  } catch (error: unknown) {
    // Recording is a convenience for the review loop; never fail a finished render over it.
    console.warn(`    pane: could not record lastRender (${String(error)})`)
  }
}
console.log(`\n  ✔ ${outPath}`)
console.log(`    ${v.width}x${v.height} · ${Number(meta.format.duration).toFixed(2)}s · ${(Number(meta.format.size) / 1024 ** 2).toFixed(1)} MB · rendered in ${wall.toFixed(1)}s`)
console.log(`    captions: ${assPath}\n    geometry: ${metaPath}`)
