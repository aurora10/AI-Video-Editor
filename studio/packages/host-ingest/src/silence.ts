/**
 * Silence / pause map: where the speech stops.
 *
 * This is what makes "cut every pause" a deterministic operation instead of a model
 * guess — the cutter gets exact regions, and captions get a hang budget. Detection is
 * FFmpeg's `silencedetect`; classification (breath vs filler vs dead air) is left to a
 * later pass that has the transcript.
 */
import { spawn } from 'node:child_process'
import { SilenceMap, type SilenceRegion } from '@dsh-video/core'

export interface SilenceOptions {
  /** Threshold below which audio counts as silence, in dBFS. -30 dB suits close-mic speech. */
  noiseDb?: number
  /** Regions shorter than this are ignored. */
  minDurationMs?: number
}

export async function detectSilence(audioPath: string, srcId: string, opts: SilenceOptions = {}): Promise<SilenceMap> {
  const noiseDb = opts.noiseDb ?? -30
  const minDurationMs = opts.minDurationMs ?? 250
  const regions = await runSilencedetect(audioPath, noiseDb, minDurationMs / 1000)
  return SilenceMap.parse({
    schemaVersion: 1,
    srcId,
    detector: `ffmpeg-silencedetect(${noiseDb}dB/${minDurationMs}ms)`,
    noiseDb,
    minDurationMs,
    regions,
  })
}

function runSilencedetect(audioPath: string, noiseDb: number, minSec: number): Promise<SilenceRegion[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-nostdin', '-v', 'info', '-i', audioPath, '-vn',
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minSec}`, '-f', 'null', '-',
    ])
    let log = ''
    child.stderr.on('data', (c: Buffer) => { log += c.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`silencedetect failed: ${log.slice(-300)}`))
      resolve(parseSilencedetect(log))
    })
  })
}

/** Parse `silence_start` / `silence_end` pairs out of the filter's log lines. */
export function parseSilencedetect(log: string): SilenceRegion[] {
  const out: SilenceRegion[] = []
  let open: number | undefined
  for (const line of log.split('\n')) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line)
    if (start?.[1] !== undefined) { open = Math.max(0, Number(start[1])); continue }
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line)
    if (end?.[1] !== undefined && open !== undefined) {
      out.push({ startMs: Math.round(open * 1000), endMs: Math.round(Number(end[1]) * 1000), kind: 'silence' })
      open = undefined
    }
  }
  // A pause that runs to the end of the file never emits silence_end.
  if (open !== undefined) out.push({ startMs: Math.round(open * 1000), endMs: -1, kind: 'silence' })
  return out.filter((r) => r.endMs < 0 || r.endMs - r.startMs >= 1)
}
