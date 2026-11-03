/**
 * Face track: where the face is, and where the chin is, over time.
 *
 * Backed by a small native tool (`tools/face-detect`, Apple Vision via Objective-C) that
 * samples frames and reports the face box plus the face contour. The chin matters because
 * captions must clear the face, and the bottom of a bounding box is not the chin — measured
 * on the reference clip, the chin sits 7–23 px *below* the box bottom.
 *
 * The track is cached next to the other analysis artifacts and keyed by the proxy it was
 * taken from, so re-renders do not re-detect.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FaceTrack, type Box } from '@dsh-video/core'

export interface FaceSample {
  atMs: number
  /** Largest face in the frame, or undefined when none was found. */
  face?: Box & { chinY: number; conf: number }
  all: (Box & { chinY: number; conf: number })[]
}

export interface FaceTrackData {
  schemaVersion: 1
  srcId: string
  width: number
  height: number
  sampleEveryMs: number
  detector: string
  samples: FaceSample[]
}

const TOOL = 'tools/face-detect'

/** Run the detector over a proxy and write `analysis/faces.<srcId>.json`. */
export async function detectFaces(opts: {
  proxyPath: string
  analysisDir: string
  srcId: string
  fps?: number
  force?: boolean
}): Promise<FaceTrackData> {
  const outPath = join(opts.analysisDir, `faces.${opts.srcId}.json`)
  if (!opts.force && existsSync(outPath)) {
    const cached = JSON.parse(await readFile(outPath, 'utf8')) as FaceTrackData
    if (cached.schemaVersion === 1) return cached
  }
  if (!existsSync(TOOL)) {
    throw new Error(`${TOOL} is not built. Run: clang -fobjc-arc -O2 -framework Foundation -framework AVFoundation -framework CoreMedia -framework CoreGraphics -framework Vision -o ${TOOL} tools/face-detect.m`)
  }
  const json = await new Promise<string>((resolve, reject) => {
    const child = spawn(TOOL, [opts.proxyPath, '--fps', String(opts.fps ?? 3)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (c: Buffer) => { out += c.toString() })
    child.stderr.on('data', (c: Buffer) => { err += c.toString() })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`face-detect exited ${code}: ${err.slice(-300)}`))))
  })
  const raw = JSON.parse(json) as {
    width: number; height: number; sampleEveryMs: number; detector: string
    frames: { atMs: number; faces: { x: number; y: number; w: number; h: number; chinX: number; chinY: number; conf: number }[] }[]
  }
  const data: FaceTrackData = {
    schemaVersion: 1,
    srcId: opts.srcId,
    width: raw.width,
    height: raw.height,
    sampleEveryMs: raw.sampleEveryMs,
    detector: raw.detector,
    samples: raw.frames.map((f) => {
      const faces = f.faces
        .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, chinY: b.chinY, conf: b.conf }))
        .sort((a, b) => b.w * b.h - a.w * a.h)
      const first = faces[0]
      return { atMs: f.atMs, ...(first === undefined ? {} : { face: first }), all: faces }
    }),
  }
  await writeFile(outPath, JSON.stringify(data, null, 1) + '\n')
  return data
}

/** Interpolated chin position (pixels, top-left origin) at a given time. */
export function chinAt(track: FaceTrackData, atMs: number, fallbackY: number): number {
  const withFace = track.samples.filter((s) => s.face !== undefined)
  if (withFace.length === 0) return fallbackY
  let before = withFace[0]!
  let after = withFace[withFace.length - 1]!
  for (const s of withFace) {
    if (s.atMs <= atMs) before = s
    if (s.atMs >= atMs) { after = s; break }
  }
  const a = before.face!.chinY
  const b = after.face!.chinY
  if (after.atMs === before.atMs) return a
  const t = Math.min(1, Math.max(0, (atMs - before.atMs) / (after.atMs - before.atMs)))
  return a + (b - a) * t
}

/** Lowest face box bottom near a time — used to assert captions do not cover a face. */
export function faceBoxAt(track: FaceTrackData, atMs: number): { y: number; bottom: number } | undefined {
  const nearest = track.samples
    .filter((s) => s.face !== undefined)
    .reduce<FaceSample | undefined>((best, s) => (best === undefined || Math.abs(s.atMs - atMs) < Math.abs(best.atMs - atMs) ? s : best), undefined)
  if (nearest?.face === undefined) return undefined
  return { y: nearest.face.y, bottom: nearest.face.y + nearest.face.h }
}

export function toCoreFaceTrack(data: FaceTrackData): FaceTrack {
  return FaceTrack.parse({
    schemaVersion: 1,
    srcId: data.srcId,
    sampleEveryMs: data.sampleEveryMs,
    detector: data.detector,
    frames: data.samples.map((s) => ({
      atMs: s.atMs,
      boxes: s.all.map((b, i) => ({ x: b.x, y: b.y, w: b.w, h: b.h, score: b.conf, id: i })),
    })),
  })
}
