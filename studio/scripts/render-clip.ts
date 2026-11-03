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
import { detectSilence, projectPaths, refineWordTimings } from '../packages/host-ingest/src/index.js'
import { compactSelectExpr, compactWindow, DEFAULT_CYRILLIC_CAPTION_STYLE, planCaptionPages, shiftWords, toAss, voicePolishChain } from '../packages/host-render/src/index.js'

const argv = process.argv.slice(2)
const slug = argv.find((a) => !a.startsWith('--'))
if (slug === undefined) { console.error('usage: pnpm render-clip <project> --from 4:47 --to 5:47 [--label name]'); process.exit(2) }
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
const mmss = (v: string) => { const [m, s] = v.split(':'); return (Math.round(Number(m) * 60 + Number(s))) * 1000 }
const fromMs = mmss(opt('from', '0:00')!)
const toMs = mmss(opt('to', '0:45')!)
const label = opt('label', 'clip')!

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

// --- captions -------------------------------------------------------------
const style = { ...DEFAULT_CYRILLIC_CAPTION_STYLE, sizePx: Math.round(H * 0.115) }
const pages = planCaptionPages(words, { frameWidth: W, style, targetWordsPerPage: 4 })
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
  `[0:v]select='${sel}',setpts=N/FRAME_RATE/TB,ass=${burnAssPath}:fontsdir=${style.fontDir}[outv]`,
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
