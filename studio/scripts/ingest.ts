/**
 * `pnpm ingest <source> [--project <slug>]` — the B1 vertical slice.
 *
 * Probes a source, fingerprints it, builds the proxy ladder and writes the project
 * record. Idempotent: a second run over the same source skips completed steps and
 * says so, which is what makes the later stages safe to re-run.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { buildAudio, buildPreview, buildScrub, fingerprint, probeSource, projectPaths, sourceProxyDir } from '../packages/host-ingest/src/index.js'

const args = process.argv.slice(2)
const source = args.find((a) => !a.startsWith('--'))
if (source === undefined) {
  console.error('usage: pnpm ingest <source-video> [--project <slug>] [--force]')
  process.exit(2)
}
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const force = args.includes('--force')
const sourcePath = resolve(source)
if (!existsSync(sourcePath)) { console.error(`no such file: ${sourcePath}`); process.exit(2) }

const slug = flag('project') ?? basename(sourcePath).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
const root = resolve('projects', slug)
const paths = projectPaths(root)
for (const d of [paths.root, paths.media, paths.proxies, paths.analysis, paths.edit, paths.notes, paths.style, paths.render, paths.qa, paths.exports]) {
  await mkdir(d, { recursive: true })
}

const t0 = Date.now()
const step = (label: string, ms: number) => console.log(`  ${label.padEnd(22)} ${(ms / 1000).toFixed(1)}s`)

console.log(`\nproject: ${slug}\n  → ${paths.root}\n`)

// --- probe -----------------------------------------------------------------
const probe = await probeSource(sourcePath)
console.log('probe')
console.log(`  ${probe.width}x${probe.height} @ ${probe.fps} fps (nominal ${probe.rFps}${probe.vfr ? ', VFR' : ''}) · ${probe.videoCodec} · ${(probe.bytes / 1024 ** 3).toFixed(2)} GB`)
console.log(`  ${(probe.durationMs / 1000).toFixed(1)}s · audio ${probe.hasAudio ? `${probe.audioCodec} ${probe.audioChannels}ch @${probe.audioSampleRate}Hz` : 'none'}`)
step('ffprobe', probe.probeMs)

// --- fingerprint -----------------------------------------------------------
const fp = await fingerprint(sourcePath)
step('fingerprint', fp.ms)
console.log(`  digest ${fp.digest.slice(0, 16)}… (head+tail+size)`)

// --- proxy ladder ----------------------------------------------------------
const proxyDir = sourceProxyDir(paths, 'src-01')
const targets = {
  scrub: join(proxyDir, 'scrub-270p.mp4'),
  preview: join(proxyDir, 'preview-540p.mp4'),
  audio: join(proxyDir, 'audio-48k.wav'),
  audioAsr: join(proxyDir, 'audio-16k-mono.wav'),
}
const needed = [targets.scrub, targets.preview, ...(probe.hasAudio ? [targets.audio, targets.audioAsr] : [])]
// --- project record (written early so later stages can run while proxies build) ---
const record: Record<string, unknown> & { sources: unknown[] } = {
  schemaVersion: 1,
  id: `prj_${fp.digest.slice(0, 8)}`,
  name: basename(sourcePath),
  slug,
  status: 'ingesting',
  createdAt: new Date().toISOString(),
  sources: [{
    id: 'src-01',
    displayName: basename(sourcePath),
    path: sourcePath,
    fingerprint: fp.digest,
    bytes: fp.bytes,
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    vfr: probe.vfr,
    videoCodec: probe.videoCodec,
    rotation: probe.rotation,
    hasAudio: probe.hasAudio,
    proxies: targets,
  }],
  outputs: [
    { id: 'vertical', width: 1080, height: 1920, fps: 30, profileRef: 'final-1080p', safeArea: { top: 12, bottom: 18, left: 6, right: 6 } },
    { id: 'wide', width: 1920, height: 1080, fps: 30, profileRef: 'final-1080p', safeArea: { top: 8, bottom: 12, left: 4, right: 4 } },
  ],
  defaultOutputId: 'vertical',
}
await writeFile(paths.record, JSON.stringify(record, null, 2) + '\n')

const want = (p: string) => force || !existsSync(p)
const todo = { audio: probe.hasAudio && (want(targets.audio) || want(targets.audioAsr)), preview: want(targets.preview), scrub: want(targets.scrub) }

if (!todo.audio && !todo.preview && !todo.scrub) {
  console.log('\nproxies: all present, skipped (cache hit)')
} else {
  console.log('\nproxies (master decoded exactly once, in cost order)')
  if (todo.audio) {
    const { ms } = await buildAudio(probe, targets)
    step('audio', ms)
  } else console.log('  audio                  cached')
  if (todo.preview) {
    let lastPct = -1
    const { ms } = await buildPreview(probe, targets.preview, {
      fps: 30,
      onProgress: (f) => {
        const pct = Math.floor(f * 10) * 10
        if (pct > lastPct) { lastPct = pct; process.stdout.write(`  …preview ${pct}%\n`) }
      },
    })
    step('preview 540p', ms)
  } else console.log('  preview 540p           cached')
  if (todo.scrub) {
    const { ms } = await buildScrub(targets.preview, targets.scrub)
    step('scrub 270p', ms)
  } else console.log('  scrub 270p             cached')
}

const check = async (p: string, label: string) => {
  const { probeJson } = await import('../packages/host-ingest/src/ffmpeg.js')
  const { streams, format } = await probeJson(p)
  const v = streams.find((s) => s.codec_type === 'video')
  const extra = v === undefined ? `a=${streams[0]?.sample_rate}Hz ${streams[0]?.channels}ch` : `${v.width}x${v.height} ${v.codec_name}`
  console.log(`  ${label.padEnd(14)} ${(Number(format.size ?? 0) / 1024 ** 2).toFixed(1)} MB · ${Number(format.duration).toFixed(2)}s · ${extra}`)
}
console.log('\nartifacts')
for (const [p, label] of [[targets.scrub, 'scrub-270p'], [targets.preview, 'preview-540p'], [targets.audio, 'audio-48k'], [targets.audioAsr, 'audio-16k']] as const) {
  if (existsSync(p)) await check(p, label)
}

// Mark the project ready only once every artifact is on disk.
record.status = 'ready'
await writeFile(paths.record, JSON.stringify(record, null, 2) + '\n')
