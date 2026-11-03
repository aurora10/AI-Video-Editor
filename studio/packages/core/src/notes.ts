/**
 * Timeline notes: "at this moment, do that".
 *
 * The authoring unit is a program time (what the viewer sees), but the STORED unit is source
 * time. The reason is stability: program time shifts whenever the cut changes (pace, a removed
 * mumble, a removed take), so a note saved in program time would silently move to a different
 * sentence after the next render. Source time is anchored to the footage, and every render maps
 * it back to program time on the way in.
 */
import { z } from 'zod'

export const NoteKind = z.enum([
  /** Remove this stretch of the source entirely. */
  'cut',
  /** Suppress captions here (a graphic, a demonstration, a moment that should breathe). */
  'hide-captions',
  /** Put a text card on screen here. */
  'text-card',
  /** Put an image inset on screen here. */
  'image-inset',
  /** A plain instruction for the agent — not something the renderer can act on alone. */
  'free',
])
export type NoteKind = z.infer<typeof NoteKind>

export const Note = z.object({
  id: z.string().regex(/^n-\d{4,}$/),
  kind: NoteKind,
  /** Anchored to the footage, so re-cuts cannot move it. */
  srcStartMs: z.number().nonnegative(),
  srcEndMs: z.number().nonnegative(),
  /** Text for a card, or the instruction for a free note. */
  text: z.string().max(2000).default(''),
  /** Asset path relative to the project root, for image-inset. */
  asset: z.string().optional(),
  createdAt: z.string(),
  status: z.enum(['open', 'applied', 'done']).default('open'),
  /** Program time at the moment of authoring, kept for display only. */
  authoredProgramMs: z.number().nonnegative().optional(),
})
export type Note = z.infer<typeof Note>

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  cut: 'Cut this',
  'hide-captions': 'No captions here',
  'text-card': 'Text card',
  'image-inset': 'Image here',
  free: 'Instruction',
}

/** Whether the renderer can act on a kind by itself. */
export const NOTE_IS_AUTOMATIC: Record<NoteKind, boolean> = {
  cut: true,
  'hide-captions': true,
  'text-card': true,
  'image-inset': true,
  free: false,
}
