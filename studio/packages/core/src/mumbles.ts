/**
 * Mumble removal: what to cut that is not a silence.
 *
 * Three sources, each with a different justification, and each deliberately conservative:
 *
 *  1. **Untranscribed bursts** — a stretch where there is sound (it is not in the silence map)
 *     but the transcription produced no words. Measured on the reference clip: 29 of 132 speech
 *     regions, 11.8 s in total, typically 400 ms. If the ASR heard no word there, there is no
 *     content to keep. This is the largest and safest source by far.
 *  2. **Hesitation sounds** — `э`, `ээ`, `мм`, `аа` and friends. Never content in any position.
 *  3. **Isolated discourse markers** — `ну`, `вот`, `значит`, `короче`. Cut ONLY when a real pause
 *     sits beside them, because in running speech the same words carry meaning: on this clip
 *     `это` appears 15 times and is almost always content ("это полнейшая чушь", "что это
 *     означает"). `это` is therefore on the never-cut list, and the isolation test is what keeps
 *     the rest honest.
 *
 * Everything here is a rule over (words, silence map). No model, no guessing, and every cut can
 * be printed with its reason.
 */
import type { SilenceMap, Word } from './analysis.js'

/** Sounds that are never content, in any position. */
export const HESITATIONS = new Set(['э', 'ээ', 'эээ', 'ээээ', 'мм', 'ммм', 'м', 'аа', 'а', 'эм', 'эхм', 'кхм', 'uh', 'um', 'er', 'ah'])

/** Discourse markers: cut only when isolated by pauses. */
export const DISCOURSE = new Set(['ну', 'вот', 'значит', 'короче', 'типа', 'вообще', 'понимаешь', 'слышь', 'well', 'like', 'so', 'right'])

/**
 * Words that look like fillers but are usually content. Kept unconditionally; a language model
 * could disambiguate them, which is exactly why this list is explicit rather than inferred.
 */
export const NEVER_CUT = new Set(['это', 'этот', 'эта', 'эти', 'так', 'так-то', 'то', 'как', 'бы', 'вот-вот'])

export interface MumbleCut {
  startMs: number
  endMs: number
  reason: 'untranscribed' | 'hesitation' | 'discourse' | 'repeat'
  detail: string
}

export interface MumbleOptions {
  /** Shorter than this is a blip (a click), longer than the max is likely content. */
  minBurstMs?: number
  maxBurstMs?: number
  /** An isolated marker needs a pause at least this long on one side. */
  isolateBeforeMs?: number
  isolateAfterMs?: number
}

const speechRegions = (silence: SilenceMap, durationMs: number): [number, number][] => {
  const closed = silence.regions.filter((r) => r.endMs > 0).sort((a, b) => a.startMs - b.startMs)
  const out: [number, number][] = []
  let cursor = 0
  for (const r of closed) {
    if (r.startMs > cursor) out.push([cursor, r.startMs])
    cursor = Math.max(cursor, r.endMs)
  }
  if (cursor < durationMs) out.push([cursor, durationMs])
  return out
}

/**
 * Classify what to cut.
 * @param words - refined transcript words in SOURCE time.
 * @param silence - the pause map.
 * @param durationMs - source duration.
 * @param opts - tuning.
 * @returns the cuts, each with the reason it exists.
 */
export function detectMumbles(words: Word[], silence: SilenceMap, durationMs: number, opts: MumbleOptions = {}): MumbleCut[] {
  const minBurstMs = opts.minBurstMs ?? 200
  const maxBurstMs = opts.maxBurstMs ?? 2500
  const isolateBefore = opts.isolateBeforeMs ?? 300
  const isolateAfter = opts.isolateAfterMs ?? 200
  const cuts: MumbleCut[] = []

  // ---- 1. sound with no words ---------------------------------------------
  for (const [start, end] of speechRegions(silence, durationMs)) {
    const len = end - start
    if (len < minBurstMs || len > maxBurstMs) continue
    const hasWord = words.some((w) => w.endMs > start + 40 && w.startMs < end - 40)
    if (!hasWord) cuts.push({ startMs: start, endMs: end, reason: 'untranscribed', detail: `${len}ms of sound with no transcribed word` })
  }

  // ---- 2. hesitations, 3. isolated markers, 4. repeated starts ------------
  words.forEach((w, i) => {
    const text = w.text.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '')
    const prev = words[i - 1]
    const next = words[i + 1]
    const gapBefore = prev === undefined ? 9999 : w.startMs - prev.endMs
    const gapAfter = next === undefined ? 9999 : next.startMs - w.endMs

    if (HESITATIONS.has(text)) {
      cuts.push({ startMs: w.startMs, endMs: w.endMs, reason: 'hesitation', detail: `"${w.text}" is a hesitation sound` })
      return
    }
    if (NEVER_CUT.has(text)) return

    // a repeat: the same word started twice
    if (next !== undefined && next.text.toLowerCase() === w.text.toLowerCase() && gapAfter <= 250) {
      cuts.push({ startMs: w.startMs, endMs: w.endMs, reason: 'repeat', detail: `"${w.text}" repeated as a false start` })
      return
    }

    if (DISCOURSE.has(text)) {
      const isolated = (gapBefore >= isolateBefore && gapAfter >= 120) || (gapAfter >= isolateAfter && gapBefore >= 120)
      const atEdge = prev === undefined || next === undefined
      if (isolated || atEdge) {
        cuts.push({ startMs: w.startMs, endMs: w.endMs, reason: 'discourse', detail: `"${w.text}" isolated by a ${Math.round(gapBefore)}/${Math.round(gapAfter)}ms pause` })
      }
    }
  })

  return cuts.sort((a, b) => a.startMs - b.startMs)
}

/** Total time a cut list removes, after merging overlaps. */
export function totalCutMs(cuts: MumbleCut[]): number {
  const merged: [number, number][] = []
  for (const c of [...cuts].sort((a, b) => a.startMs - b.startMs)) {
    const last = merged[merged.length - 1]
    if (last !== undefined && c.startMs <= last[1]) last[1] = Math.max(last[1], c.endMs)
    else merged.push([c.startMs, c.endMs])
  }
  return merged.reduce((n, [a, b]) => n + (b - a), 0)
}
