/**
 * Source probe: everything downstream needs to know about a file before it can be
 * planned — duration, geometry, frame rate, whether it is VFR, rotation, audio.
 */
import { probeJson } from './ffmpeg.js'

export interface SourceProbe {
  path: string
  bytes: number
  durationMs: number
  width: number
  height: number
  /** Effective frame rate as ffprobe reports it (may be a long rational on VFR). */
  fps: number
  rFps: number
  /** True when average and nominal frame rates disagree by more than 1%. */
  vfr: boolean
  videoCodec: string
  rotation: 0 | 90 | 180 | 270
  hasAudio: boolean
  audioCodec?: string
  audioChannels?: number
  audioSampleRate?: number
  probeMs: number
}

const ratio = (s: string | undefined): number => {
  if (s === undefined || s === '0/0') return 0
  const [a, b] = s.split('/')
  const n = Number(a)
  const d = b === undefined ? 1 : Number(b)
  return d === 0 ? 0 : n / d
}

export async function probeSource(path: string): Promise<SourceProbe> {
  const { streams, format, ms } = await probeJson(path)
  const v = streams.find((s) => s.codec_type === 'video')
  if (v === undefined) throw new Error(`no video stream in ${path}`)
  const a = streams.find((s) => s.codec_type === 'audio')

  const rFps = ratio(v.r_frame_rate)
  const avgFps = ratio(v.avg_frame_rate)
  const fps = avgFps > 0 ? avgFps : rFps
  const vfr = rFps > 0 && Math.abs(avgFps - rFps) / rFps > 0.01

  const rotation = (v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360 as 0 | 90 | 180 | 270

  return {
    path,
    bytes: Number(format.size ?? 0),
    durationMs: Math.round(Number(format.duration ?? 0) * 1000),
    // Rotated sources report pre-rotation geometry; swap for the display box.
    width: normalized === 90 || normalized === 270 ? (v.height ?? 0) : (v.width ?? 0),
    height: normalized === 90 || normalized === 270 ? (v.width ?? 0) : (v.height ?? 0),
    fps: Number(fps.toFixed(4)),
    rFps: Number(rFps.toFixed(4)),
    vfr,
    videoCodec: v.codec_name ?? 'unknown',
    rotation: normalized,
    hasAudio: a !== undefined,
    ...(a?.codec_name === undefined ? {} : { audioCodec: a.codec_name }),
    ...(a?.channels === undefined ? {} : { audioChannels: a.channels }),
    ...(a?.sample_rate === undefined ? {} : { audioSampleRate: Number(a.sample_rate) }),
    probeMs: ms,
  }
}
