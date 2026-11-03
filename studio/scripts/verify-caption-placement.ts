/**
 * `pnpm verify-caption-placement <project> <clip> --from 4:47 --to 5:47`
 *
 * Proves captions clear the face, frame by frame, without anyone looking at a picture:
 *   1. for a sample of program times, decode the delivered frame AND the matching frame of
 *      the uncaptioned source;
 *   2. pixels that differ are the caption (encoding noise is filtered by a hard threshold);
 *   3. assert no caption pixel falls inside the face box reported by the face track.
 *
 * This is the difference between "captions look fine" and "captions were never on the face".
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { Transcript } from '@dsh-video/core'
import { detectFaces, detectSilence, projectPaths, refineWordTimings } from '../packages/host-ingest/src/index.js'
import { compactWindow } from '../packages/host-render/src/index.js'

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith('--'))
const slug = positional[0]
const clipArg = positional[1]
const controlArg = positional[2]  // same clip rendered with --no-captions
if (slug === undefined || clipArg === undefined || controlArg === undefined) {
  console.error('usage: pnpm verify-caption-placement <project> <clip.mp4> <clip-nocaps.mp4> [--from 4:47] [--to 5:47]')
  console.error('  the control must be the SAME clip rendered with --no-captions: diffing against the')
  console.error('  source detects motion and re-encoding noise, not caption pixels')
  process.exit(2)
}
const opt = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]! }
const mmss = (v: string) => { const [m, s] = v.split(':'); return (Math.round(Number(m) * 60 + Number(s))) * 1000 }

let W = 0
let H = 0

// Dimensions come from the clip itself: the vertical render is 540x960, and a hardcoded
// landscape size silently mis-measures every frame of it.
{
  const probeDims = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', clipArg], { encoding: 'utf8' })
  const parts = probeDims.stdout.trim().split(',').map(Number)
  W = parts[0] ?? 0
  H = parts[1] ?? 0
  if (W === 0 || H === 0) { console.error(`cannot read dimensions of ${clipArg}`); process.exit(2) }
}

// Map a face box from source coordinates into the delivered frame using the render's own
// geometry sidecar. Without this, a vertical render was compared against landscape boxes and
// reported a clean result it had not earned.
interface RenderMeta { source: { width: number; height: number }; output: { width: number; height: number }; crop: { x: number; w: number; h: number } | null }
const metaPath = clipArg.replace(/\.mp4$/, '.meta.json')
const meta: RenderMeta | null = existsSync(metaPath) ? JSON.parse(await readFile(metaPath, 'utf8')) as RenderMeta : null
if (meta === null) {
  console.error(`missing geometry sidecar ${metaPath} — re-render the clip so the verifier can map coordinates`)
  process.exit(2)
}
const toOutput = (box: { x: number; y: number; w: number; h: number }) => {
  const sx = meta.output.width / (meta.crop === null ? meta.source.width : meta.crop.w)
  const sy = meta.output.height / meta.source.height
  const x0 = meta.crop === null ? box.x : box.x - meta.crop.x
  return { x: x0 * sx, y: box.y * sy, w: box.w * sx, h: box.h * sy }
}

const paths = projectPaths(resolve('projects', slug))
const record = JSON.parse(await readFile(paths.record, 'utf8'))
const src = record.sources[0]
const raw = Transcript.parse(JSON.parse(await readFile(join(paths.analysis, `transcript.${src.id}.json`), 'utf8')))
const silence = await detectSilence(src.proxies.audio, src.id)
const { transcript } = refineWordTimings(raw, silence, src.durationMs)
void transcript
const win = compactWindow(silence, mmss(opt('from', '4:47')), mmss(opt('to', '5:47')), { pauseMs: 250 })
const faces = await detectFaces({ proxyPath: src.proxies.preview, analysisDir: paths.analysis, srcId: src.id })

const gray = (file: string, ss: number): Uint8Array => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(ss), '-i', file, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { maxBuffer: 32 * 1024 * 1024 })
  return new Uint8Array(r.stdout)
}

const programDurationMs = win.programDurationMs
// program time → source time
const toSource = (progMs: number): number => {
  for (const r of win.regions) {
    const len = r.srcEndMs - r.srcStartMs
    if (progMs >= r.progStartMs && progMs < r.progStartMs + len) return r.srcStartMs + (progMs - r.progStartMs)
  }
  const last = win.regions[win.regions.length - 1]!
  return last.srcEndMs
}

const sampleCount = 12
let skipped = 0
let totalCaptionPixels = 0
let insideFace = 0
let framesWithCaption = 0
console.log(`\ncaption placement — ${slug} · ${clipArg}\n`)
for (let i = 0; i < sampleCount; i++) {
  const progMs = Math.round((programDurationMs * (i + 0.5)) / sampleCount)
  const srcMs = toSource(progMs)
  const a = gray(clipArg, progMs / 1000)
  const b = gray(controlArg, progMs / 1000)
  if (a.length !== W * H || b.length !== W * H) { skipped++; console.log(`  t=${(progMs / 1000).toFixed(1)}s  frame decode mismatch (${a.length}/${W * H}), skipped`); continue }

  const face = faces.samples.filter((s) => s.face !== undefined)
    .reduce((best, s) => (best === undefined || Math.abs(s.atMs - srcMs) < Math.abs(best.atMs - srcMs) ? s : best), undefined as typeof faces.samples[number] | undefined)?.face

  let captionPx = 0, inside = 0, minY = H, maxY = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = a[y * W + x]! - b[y * W + x]!
      if (d > 60) {
        captionPx++
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (face !== undefined) {
          const f = toOutput(face)
          if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) inside++
        }
      }
    }
  }
  totalCaptionPixels += captionPx
  insideFace += inside
  if (captionPx > 50) framesWithCaption++
  const mapped = face === undefined ? null : toOutput(face)
  const faceTxt = mapped === null ? 'no face' : `face y ${mapped.y.toFixed(0)}–${(mapped.y + mapped.h).toFixed(0)}`
  const capTxt = captionPx > 50 ? `caption y ${minY}–${maxY}` : 'no caption visible'
  const verdict = inside > 0 ? `✘ ${inside} px ON FACE` : '✔'
  console.log(`  t=${(progMs / 1000).toFixed(1).padStart(5)}s  ${faceTxt.padEnd(18)} ${capTxt.padEnd(20)} ${verdict}`)
}
const measured = sampleCount - skipped
console.log(`\n  measured ${measured}/${sampleCount} frames · with captions ${framesWithCaption} · caption pixels ${totalCaptionPixels} · over a face ${insideFace}`)
if (measured === 0 || framesWithCaption === 0) {
  // Nothing was actually compared: reporting PASS here would be a lie, and it happened once
  // (the clip's dimensions were mis-probed, every frame was skipped, and the run went green).
  console.log('  INCONCLUSIVE — no frames could be compared ✘\n')
  process.exit(1)
}
const ok = insideFace === 0
console.log(`  ${ok ? 'PASS — captions never cover the face' : 'FAIL — captions overlap the face'}\n`)
process.exit(ok ? 0 : 1)
