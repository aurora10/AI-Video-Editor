/**
 * The proxy ladder — ordered by cost, not by convenience.
 *
 * Measured on the reference machine: 4K60 HEVC from this source decodes at **~0.24×
 * realtime** in software (VideoToolbox was *slower*, 0.19×). So the master is
 * decoded EXACTLY ONCE, and every later pass works off a proxy:
 *
 *   1. audio      audio-only demux            — seconds; unblocks transcription immediately
 *   2. preview    540p CFR, GOP 15            — the one expensive decode of the master
 *   3. scrub      270p all-intra              — derived from the 540p preview, not the master
 *
 * Deriving the scrub proxy from the preview is the difference between one 4K decode
 * and two: seek performance depends on intra-only encoding, not on source fidelity.
 */
import { mkdir, rename, rm } from 'node:fs/promises'
import { run } from './ffmpeg.js'
import type { SourceProbe } from './probe.js'

export interface ProxyTargets {
  scrub: string
  preview: string
  audio: string
  audioAsr: string
}

const dirOf = (p: string) => p.replace(/\/[^/]+$/, '')

/** `a/b/c.wav` → `a/b/c.part.wav` (extension preserved for the muxer). */
export const tempName = (target: string): string => target.replace(/\.([a-z0-9]+)$/i, '.part.$1')

/**
 * Encode to `<target>.part` and rename on success.
 *
 * A half-written proxy that survives a crash must never look complete: the ingest
 * step is *idempotent by file existence*, so a truncated file would be treated as a
 * cache hit forever. Rename is atomic within a directory.
 */
async function atomic(target: string, encode: (tmp: string) => Promise<{ ms: number }>): Promise<{ ms: number }> {
  // Keep the real extension: ffmpeg infers the muxer from it, so `x.wav.part` fails.
  const tmp = tempName(target)
  await mkdir(dirOf(target), { recursive: true })
  await rm(tmp, { force: true })
  const result = await encode(tmp)
  await rename(tmp, target)
  return result
}

/** Step 1 — audio only (48 kHz stereo for mixing, 16 kHz mono for the ASR upload). */
export async function buildAudio(probe: SourceProbe, targets: ProxyTargets): Promise<{ ms: number }> {
  if (!probe.hasAudio) return { ms: 0 }
  // Both audio outputs come from one demux; the rename guards the 48 kHz file, and
  // the ASR file is written directly because a truncated 16 kHz copy would be caught
  // by the ASR transcript-length check downstream.
  return atomic(targets.audio, async (tmp) => {
    const asrTmp = tempName(targets.audioAsr)
    const { ms } = await run('ffmpeg', [
      '-hide_banner', '-nostdin', '-y', '-i', probe.path, '-vn',
      '-map', '0:a', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', tmp,
      '-map', '0:a', '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1', asrTmp,
    ])
    await rename(asrTmp, targets.audioAsr)
    return { ms }
  })
}

/** Step 2 — the single decode of the master; also normalises VFR to a constant rate. */
export async function buildPreview(
  probe: SourceProbe,
  target: string,
  opts: { fps?: number; height?: number; onProgress?: (fraction: number) => void } = {},
): Promise<{ ms: number }> {
  const fps = opts.fps ?? 30
  const height = opts.height ?? 540
  const total = probe.durationMs / 1000
  const onProgress = opts.onProgress
  return atomic(target, async (tmp) => run('ffmpeg', [
    '-hide_banner', '-nostdin', '-y', '-i', probe.path, '-an',
    '-vf', `scale=-2:${height},fps=${fps}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
    '-g', String(Math.round(fps / 2)), '-keyint_min', String(Math.round(fps / 2)),
    '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', tmp,
  ], onProgress === undefined ? {} : { onProgress: (done) => onProgress(Math.min(1, done / total)) }))
}

/** Step 3 — all-intra scrub proxy, derived from the preview (cheap: 540p decode). */
export async function buildScrub(
  previewPath: string,
  target: string,
  opts: { durationMs?: number; height?: number } = {},
): Promise<{ ms: number }> {
  const height = opts.height ?? 270
  return atomic(target, async (tmp) => run('ffmpeg', [
    '-hide_banner', '-nostdin', '-y', '-i', previewPath, '-an',
    '-vf', `scale=-2:${height}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
    '-g', '1', '-keyint_min', '1', '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', tmp,
  ]))
}

/** Convenience: the whole ladder in the measured-cheapest order. */
export async function buildProxies(
  probe: SourceProbe,
  targets: ProxyTargets,
  opts: { fps?: number; onProgress?: (phase: string, fraction: number) => void } = {},
): Promise<{ audioMs: number; previewMs: number; scrubMs: number }> {
  const audio = await buildAudio(probe, targets)
  opts.onProgress?.('audio', 1)
  const preview = opts.onProgress === undefined
    ? await buildPreview(probe, targets.preview, opts.fps === undefined ? {} : { fps: opts.fps })
    : await buildPreview(probe, targets.preview, { ...(opts.fps === undefined ? {} : { fps: opts.fps }), onProgress: (f) => opts.onProgress?.('preview', f) })
  const scrub = await buildScrub(targets.preview, targets.scrub, { durationMs: probe.durationMs })
  opts.onProgress?.('scrub', 1)
  return { audioMs: audio.ms, previewMs: preview.ms, scrubMs: scrub.ms }
}
