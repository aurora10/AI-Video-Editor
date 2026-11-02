/**
 * EDL v1 — the single source of truth for an edit.
 *
 * Design contract (see docs/development-plan.md §6.4):
 *  - timing is expressed as *anchors* (word / silence / beat / clip / explicit time), never as
 *    bare seconds unless explicitly authored as `time`;
 *  - the array order of `clips` IS program order;
 *  - this module is pure: no `node:*`, no DOM, no clock, no randomness. It is bundled into both
 *    the host renderer and the browser preview, and both must agree byte for byte.
 */
import { z } from 'zod'

export const EDL_SCHEMA_VERSION = 1 as const

// ---------------------------------------------------------------------------
// anchors
// ---------------------------------------------------------------------------

/** A reference to a stable transcription word id, e.g. `w-00311`. */
export const WordId = z.string().regex(/^w-\d{4,}$/, 'word id must look like w-00311')
/** A stable clip id, e.g. `c-07`. */
export const ClipId = z.string().regex(/^c-\d{2,}$/, 'clip id must look like c-07')
/** A stable item id, e.g. `t-112`, `v-04`, `e-01`, `a-03`. */
export const ItemId = z.string().regex(/^[tvea]-\d{2,}$/, 'item id must look like t-112')

/**
 * Timing anchor. `time` is the documented escape hatch and the renderer's only
 * last-resort form; every other kind survives a re-cut or a re-transcription.
 */
export const Anchor = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('word'),
    word: WordId,
    /** Milliseconds added to the word's start/end. Negative is allowed. */
    offsetMs: z.number().int().default(0),
  }),
  z.object({
    kind: z.literal('silence'),
    id: z.string().min(1),
    edge: z.enum(['start', 'end']),
    offsetMs: z.number().int().default(0),
  }),
  z.object({
    kind: z.literal('beat'),
    index: z.number().int().nonnegative(),
    offsetMs: z.number().int().default(0),
  }),
  z.object({
    kind: z.literal('clip'),
    clip: ClipId,
    edge: z.enum(['start', 'end']),
    offsetMs: z.number().int().default(0),
  }),
  z.object({ kind: z.literal('time'), ms: z.number().int().nonnegative() }),
])
export type Anchor = z.infer<typeof Anchor>

/** A half-open-on-the-outside span between two anchors. */
export const Span = z
  .object({
    from: Anchor,
    to: Anchor,
    /** Resolver clamps the resolved duration to at least this. */
    minMs: z.number().int().nonnegative().optional(),
    /** …and at most this. */
    maxMs: z.number().int().positive().optional(),
  })
  .refine((s) => s.minMs === undefined || s.maxMs === undefined || s.minMs <= s.maxMs, {
    message: 'Span.minMs must not exceed Span.maxMs',
  })
export type Span = z.infer<typeof Span>

// ---------------------------------------------------------------------------
// clips (the cut list)
// ---------------------------------------------------------------------------

export const Transition = z.object({
  kind: z.enum(['crossfade', 'dip', 'whip', 'slide']),
  durationMs: z.number().int().positive().max(2000),
})
export type Transition = z.infer<typeof Transition>

export const CutClip = z.object({
  id: ClipId,
  src: z.string().min(1),
  /** Source-space anchor for the first kept frame. */
  in: Anchor,
  /** Source-space anchor for the first *dropped* frame (exclusive). */
  out: Anchor,
  speed: z.number().min(0.25).max(4).default(1),
  role: z.enum(['a-roll', 'b-roll', 'screen', 'music-video']).default('a-roll'),
  gainDb: z.number().min(-60).max(24).optional(),
  transitionIn: Transition.optional(),
})
export type CutClip = z.infer<typeof CutClip>

// ---------------------------------------------------------------------------
// overlays
// ---------------------------------------------------------------------------

export const BoxHints = z.object({
  anchor: z
    .enum(['auto', 'below-chin', 'top-safe', 'bottom-safe', 'center', 'beside-subject'])
    .default('auto'),
  dxPx: z.number().default(0),
  dyPx: z.number().default(0),
  widthPct: z.number().min(1).max(100).optional(),
  rotationDeg: z.number().min(-45).max(45).default(0),
  avoid: z.array(z.enum(['faces', 'title-safe', 'other-text', 'subject'])).default([]),
  align: z.enum(['left', 'center', 'right']).default('center'),
})
export type BoxHints = z.infer<typeof BoxHints>

export const TextClip = z.object({
  id: ItemId,
  kind: z.enum(['caption', 'title', 'lower-third', 'statement', 'stat', 'label']),
  during: Span,
  /** Caption pages: the word ids this page renders. */
  words: z.array(WordId).optional(),
  /** Authored text for title/lower-third/statement/stat/label. */
  text: z.string().optional(),
  preset: z.string().min(1),
  box: BoxHints.default({}),
  /** Words per caption page, when the planner groups them. */
  group: z.number().int().min(1).max(6).optional(),
  emphasis: z
    .array(z.object({ word: WordId, style: z.enum(['accent', 'scale', 'underline']) }))
    .optional(),
  /** Human micro-edits. Never mutates resolver inputs (ADR: caption-overrides pattern). */
  overrides: z.record(z.string(), z.unknown()).optional(),
})
export type TextClip = z.infer<typeof TextClip>

export const VisualClip = z.object({
  id: ItemId,
  kind: z.enum(['broll', 'still', 'screen', 'composition', 'cutout']),
  during: Span,
  source: z.union([
    z.object({ asset: z.string().min(1) }),
    z.object({ src: z.string().min(1), in: Anchor, out: Anchor.optional() }),
  ]),
  layout: z.enum([
    'fullscreen',
    'inset-tl',
    'inset-tr',
    'inset-bl',
    'inset-br',
    'split-top',
    'split-bottom',
    'cluster',
  ]),
  box: BoxHints.optional(),
  motion: z.string().optional(),
  fit: z.enum(['cover', 'contain']).default('cover'),
  radiusPx: z.number().nonnegative().default(0),
  shadow: z.boolean().default(false),
  z: z.number().int().default(10),
})
export type VisualClip = z.infer<typeof VisualClip>

export const EffectClip = z.object({
  id: ItemId,
  kind: z.enum(['zoom', 'shake', 'color', 'blur', 'speed-ramp', 'vignette']),
  during: Span,
  params: z.record(z.string(), z.unknown()).default({}),
})
export type EffectClip = z.infer<typeof EffectClip>

export const AudioClip = z.object({
  id: ItemId,
  kind: z.enum(['music', 'sfx', 'room', 'voice-treatment']),
  during: Span,
  source: z.union([z.object({ asset: z.string().min(1) }), z.object({ src: z.string().min(1) })]),
  gainDb: z.number().min(-60).max(24).optional(),
  fadeInMs: z.number().int().nonnegative().default(0),
  fadeOutMs: z.number().int().nonnegative().default(0),
  duck: z
    .object({ by: z.literal('voice'), targetDeltaDb: z.number().min(0).max(60) })
    .optional(),
})
export type AudioClip = z.infer<typeof AudioClip>

// ---------------------------------------------------------------------------
// rules, derivations, the EDL
// ---------------------------------------------------------------------------

export const Constraint = z.object({
  id: z.string().min(1),
  rule: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  severity: z.enum(['block', 'warn']).default('warn'),
})
export type Constraint = z.infer<typeof Constraint>

export const Derivation = z.object({
  id: z.string().regex(/^reel-\d{2,}$/),
  kind: z.enum(['reel', 'short', 'clip']),
  fromSpan: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }),
  outputId: z.string().min(1),
  reframe: z.enum(['center', 'follow-face', 'split-subject']).default('follow-face'),
  overrides: z
    .object({
      text: z.array(TextClip).optional(),
      visuals: z.array(VisualClip).optional(),
      hookText: z.string().optional(),
    })
    .optional(),
})
export type Derivation = z.infer<typeof Derivation>

export const OutputTarget = z.object({
  id: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive().max(240),
  profileRef: z.enum(['preview-540p', 'final-1080p', 'final-4k']).default('final-1080p'),
  /** Percent insets that overlays must respect. */
  safeArea: z
    .object({
      top: z.number().min(0).max(50),
      bottom: z.number().min(0).max(50),
      left: z.number().min(0).max(50),
      right: z.number().min(0).max(50),
    })
    .default({ top: 12, bottom: 18, left: 6, right: 6 }),
})
export type OutputTarget = z.infer<typeof OutputTarget>

export const Edl = z
  .object({
    schemaVersion: z.literal(EDL_SCHEMA_VERSION),
    rev: z.number().int().nonnegative(),
    projectId: z.string().min(1),
    fps: z.number().int().positive().max(240),
    clips: z.array(CutClip).min(1),
    text: z.array(TextClip).default([]),
    visuals: z.array(VisualClip).default([]),
    effects: z.array(EffectClip).default([]),
    audio: z.array(AudioClip).default([]),
    constraints: z.array(Constraint).default([]),
    derivations: z.array(Derivation).default([]),
  })
  .superRefine((edl, ctx) => {
    const seen = new Set<string>()
    const claim = (id: string, where: string) => {
      if (seen.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate id ${id} (${where})` })
      }
      seen.add(id)
    }
    for (const c of edl.clips) claim(c.id, 'clips')
    for (const t of edl.text) claim(t.id, 'text')
    for (const v of edl.visuals) claim(v.id, 'visuals')
    for (const e of edl.effects) claim(e.id, 'effects')
    for (const a of edl.audio) claim(a.id, 'audio')
  })
export type Edl = z.infer<typeof Edl>
