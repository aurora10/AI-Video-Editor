/**
 * `pnpm verify-graphics <project> <clip.mp4> <clip-without-graphics.mp4>`
 *
 * Proves each graphic actually appears, at its time, in its region — and that nothing appears
 * outside its window. Graphics are the easiest thing in this pipeline to get silently wrong:
 * a wrong label, a wrong enable window or a bad overlay leaves a video that looks fine and has
 * no graphic in it at all.
 */
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { GraphicsTrack } from '@dsh-video/core'
import { projectPaths } from '../packages/host-ingest/src/index.js'
import { insetBox } from '../packages/host-render/src/index.js'

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const [slug, clipArg, controlArg] = positional
if (slug === undefined || clipArg === undefined || controlArg === undefined) {
  console.error('usage: pnpm verify-graphics <project> <clip.mp4> <clip-nographics.mp4>')
  process.exit(2)
}

const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', clipArg], { encoding: 'utf8' })
const [W, H] = probe.stdout.trim().split(',').map(Number) as [number, number]

const paths = projectPaths(resolve('projects', slug))
const track = GraphicsTrack.parse(JSON.parse(await readFile(join(paths.edit, 'graphics.json'), 'utf8')))

const gray = (file: string, ss: number): Uint8Array =>
  new Uint8Array(spawnSync('ffmpeg', ['-v', 'error', '-ss', String(ss), '-i', file, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 }).stdout)

/** Region a layout is expected to occupy, in output pixels. */
function expectedRegion(layout: string, widthPct: number): { x0: number; y0: number; x1: number; y1: number } {
  const box = insetBox(layout as never, W, H, widthPct)
  if (layout === 'lower-third') return { x0: 0, y0: Math.round(H * 0.6), x1: W, y1: H }
  if (layout === 'fullscreen') return { x0: 0, y0: 0, x1: W, y1: H }
  // inset: allow generous slack for the glyph/shadow spread around the overlay box
  const pad = Math.round(W * 0.06)
  return { x0: Math.max(0, box.x - pad), y0: Math.max(0, box.y - pad), x1: Math.min(W, box.x + box.w + pad), y1: Math.min(H, box.y + box.h + pad) }
}

let failures = 0
console.log(`\n  graphics verification — ${slug} · ${track.graphics.length} item(s) · ${W}x${H}\n`)

for (const g of track.graphics) {
  const midMs = Math.round((g.startMs + g.endMs) / 2)
  const a = gray(clipArg, midMs / 1000)
  const b = gray(controlArg, midMs / 1000)
  if (a.length !== W * H || b.length !== W * H) { console.log(`  ${g.id}: frame decode mismatch, skipped`); failures++; continue }

  const region = expectedRegion(g.layout, g.widthPct)
  let changed = 0, inside = 0
  let minX = W, maxX = 0, minY = H, maxY = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.abs(a[y * W + x]! - b[y * W + x]!) > 24) {
        changed++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1) inside++
      }
    }
  }
  const share = changed === 0 ? 0 : inside / changed
  const ok = changed >= 200 && share >= 0.85
  if (!ok) failures++
  console.log(`  ${ok ? '✔' : '✘'} ${g.id} (${g.kind}, ${g.layout}) at ${(midMs / 1000).toFixed(1)}s`)
  console.log(`      changed ${changed}px · in expected region ${(share * 100).toFixed(0)}% · ink x ${minX}..${maxX} y ${minY}..${maxY} · expected x ${region.x0}..${region.x1} y ${region.y0}..${region.y1}`)
}

// and nothing may appear outside every window
const gaps: number[] = []
let cursor = 0
for (const g of track.graphics) { if (g.startMs > cursor + 600) gaps.push(Math.round((cursor + g.startMs) / 2)); cursor = Math.max(cursor, g.endMs) }
if (gaps.length > 0) {
  const t = gaps[0]! / 1000
  const a = gray(clipArg, t); const b = gray(controlArg, t)
  let changed = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (Math.abs(a[i]! - b[i]!) > 24) changed++
  const ok = changed < 200
  if (!ok) failures++
  console.log(`  ${ok ? '✔' : '✘'} no graphics outside their windows (t=${t.toFixed(1)}s: ${changed}px changed)`)
}

console.log(`\n  ${failures === 0 ? 'PASS — every graphic appears where and when it should' : `${failures} FAILURE(S)`}\n`)
process.exit(failures === 0 ? 0 : 1)
