/**
 * Child-process helpers for the ingest steps.
 *
 * Everything goes through spawn with an argument array (never a shell string), so
 * a filename containing spaces, quotes or `$(...)` is inert. Progress lines are
 * parsed from `-progress pipe:1` where a step is long enough to need them.
 */
import { spawn } from 'node:child_process'

export interface RunResult {
  ms: number
  stderrTail: string
}

/** Run a binary to completion, streaming stderr tail into the error on failure. */
export function run(bin: string, args: string[], opts: { onProgress?: (doneSeconds: number) => void } = {}): Promise<RunResult> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000)
    })
    const onProgress = opts.onProgress
    if (onProgress !== undefined) {
      let buffered = ''
      child.stdout.on('data', (chunk: Buffer) => {
        buffered += chunk.toString()
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) {
          const m = /^out_time_ms=(\d+)$/.exec(line.trim())
          if (m?.[1] !== undefined) onProgress(Number(m[1]) / 1e6)
        }
      })
    } else {
      child.stdout.resume()
    }
    child.on('error', reject)
    child.on('close', (code) => {
      const ms = Date.now() - started
      if (code === 0) resolve({ ms, stderrTail: stderr.slice(-2000) })
      else reject(new Error(`${bin} exited ${code}: ${stderr.trim().split('\n').slice(-6).join(' | ')}`))
    })
  })
}

/** `ffprobe -show_streams -show_format` as parsed JSON plus the raw probe call. */
export async function probeJson(path: string): Promise<{
  streams: { codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; nb_frames?: string; channels?: number; sample_rate?: string; duration?: string; tags?: Record<string, string>; side_data_list?: { rotation?: number }[] }[]
  format: { duration?: string; size?: string; bit_rate?: string; format_name?: string; tags?: Record<string, string> }
  ms: number
}> {
  const child = spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path])
  let out = ''
  let err = ''
  const started = Date.now()
  child.stdout.on('data', (c: Buffer) => { out += c.toString() })
  child.stderr.on('data', (c: Buffer) => { err += c.toString() })
  const code: number = await new Promise((resolve) => child.on('close', (c) => resolve(c ?? 1)))
  if (code !== 0) throw new Error(`ffprobe failed on ${path}: ${err.slice(-400)}`)
  const json = JSON.parse(out)
  return { ...json, ms: Date.now() - started }
}
