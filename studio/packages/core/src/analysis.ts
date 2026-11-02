/**
 * Analysis artifacts: the structured facts every later stage depends on.
 *
 * Types live in `core` (not in host-ingest) because the resolver needs them and the
 * browser preview will eventually want the face boxes for its own safe-zone
 * rendering. Pure data, zod-validated at the file boundary.
 */
import { z } from 'zod'

/** A stable transcription word. The id is the anchor currency of the whole EDL. */
export const Word = z.object({
  id: z.string().regex(/^w-\d{4,}$/),
  /** Display text: punctuation stripped, original casing kept. */
  text: z.string(),
  /** Exactly as the provider returned it (may include punctuation). */
  raw: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  conf: z.number().min(0).max(1).default(1),
  speaker: z.string().optional(),
})
export type Word = z.infer<typeof Word>

export const TranscriptSegment = z.object({
  id: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  text: z.string(),
  speaker: z.string().optional(),
})
export type TranscriptSegment = z.infer<typeof TranscriptSegment>

export const Transcript = z.object({
  schemaVersion: z.literal(1),
  srcId: z.string(),
  language: z.string(),
  /** Which side of the seam produced this: a hosted API or a local model. */
  provider: z.enum(['api', 'local']),
  model: z.string(),
  /** Metered spend for this source, when the provider bills per minute. */
  costUsd: z.number().nonnegative().optional(),
  audioFingerprint: z.string(),
  words: z.array(Word),
  segments: z.array(TranscriptSegment).default([]),
})
export type Transcript = z.infer<typeof Transcript>

export const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
export type Box = z.infer<typeof Box>

/** One sampled frame of face detection; `boxes` are top-left origin, pixels of the source. */
export const FaceFrame = z.object({
  atMs: z.number().nonnegative(),
  boxes: z.array(Box.extend({ score: z.number(), id: z.number().int() })),
})
export type FaceFrame = z.infer<typeof FaceFrame>

export const FaceTrack = z.object({
  schemaVersion: z.literal(1),
  srcId: z.string(),
  sampleEveryMs: z.number().positive(),
  detector: z.string(),
  frames: z.array(FaceFrame),
})
export type FaceTrack = z.infer<typeof FaceTrack>

export const SilenceRegion = z.object({
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  kind: z.enum(['silence', 'breath', 'filler']).default('silence'),
})
export type SilenceRegion = z.infer<typeof SilenceRegion>

export const SilenceMap = z.object({
  schemaVersion: z.literal(1),
  srcId: z.string(),
  detector: z.string(),
  noiseDb: z.number(),
  minDurationMs: z.number(),
  regions: z.array(SilenceRegion),
})
export type SilenceMap = z.infer<typeof SilenceMap>

export const BeatGrid = z.object({
  schemaVersion: z.literal(1),
  srcId: z.string(),
  bpm: z.number().positive(),
  beatsMs: z.array(z.number().nonnegative()),
  downbeatsMs: z.array(z.number().nonnegative()).default([]),
})
export type BeatGrid = z.infer<typeof BeatGrid>
