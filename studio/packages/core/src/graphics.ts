/**
 * Graphics and B-roll: what may be layered on top of the picture.
 *
 * A project describes its graphics in `edit/graphics.json`; the renderer composites them. Times
 * are PROGRAM time (after pauses are removed), because that is the timeline the viewer sees.
 *
 * Deliberately small: three kinds that cover the common cases, four layouts, and a fade. A track
 * that can express anything is a track nobody can verify.
 */
import { z } from 'zod'

export const GraphicLayout = z.enum([
  'fullscreen',
  'inset-tr',
  'inset-tl',
  'inset-br',
  'inset-bl',
  'lower-third',
])
export type GraphicLayout = z.infer<typeof GraphicLayout>

export const GraphicMotion = z.enum(['none', 'fade', 'slide-up'])
export type GraphicMotion = z.infer<typeof GraphicMotion>

const Base = {
  id: z.string().min(1),
  /** Program-time span in milliseconds. */
  startMs: z.number().nonnegative(),
  endMs: z.number().positive(),
  layout: GraphicLayout.default('inset-tr'),
  motion: GraphicMotion.default('fade'),
  /** Fraction of the frame the graphic occupies, for inset layouts. */
  widthPct: z.number().min(5).max(100).default(38),
}

export const ImageGraphic = z.object({
  ...Base,
  kind: z.literal('image'),
  /** Path relative to the project root. */
  src: z.string().min(1),
  radiusPx: z.number().nonnegative().default(12),
})

export const VideoGraphic = z.object({
  ...Base,
  kind: z.literal('video'),
  src: z.string().min(1),
  /** Offset into the source clip, ms. */
  srcStartMs: z.number().nonnegative().default(0),
})

export const TextGraphic = z.object({
  ...Base,
  kind: z.literal('text'),
  text: z.string().min(1),
  /** Secondary line, e.g. a role or a source. */
  subtext: z.string().optional(),
  accent: z.string().default('&H0000FFFF'),
})

export const Graphic = z.discriminatedUnion('kind', [ImageGraphic, VideoGraphic, TextGraphic])
export type Graphic = z.infer<typeof Graphic>

export const GraphicsTrack = z.object({
  schemaVersion: z.literal(1),
  graphics: z.array(Graphic).default([]),
})
export type GraphicsTrack = z.infer<typeof GraphicsTrack>

export const EMPTY_GRAPHICS: GraphicsTrack = { schemaVersion: 1, graphics: [] }
