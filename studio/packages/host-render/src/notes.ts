/**
 * Turning timeline notes into render instructions.
 *
 * Notes are stored in source time (see core/notes.ts). This module maps them onto the CURRENT
 * program timeline, so a note keeps pointing at the same sentence even after the cut changes.
 */
import type { Graphic, Note } from '@dsh-video/core'
import type { CompactedWindow } from './cut.js'

export interface AppliedNotes {
  /** Source spans to remove. */
  extraCuts: [number, number][]
  /** Program ranges where captions are suppressed. */
  captionSuppressed: [number, number][]
  /** Graphics contributed by notes, in program time. */
  graphics: Graphic[]
  /** Notes the renderer cannot act on — for the agent, not the encoder. */
  unhandled: Note[]
  /** How many 'cut' notes were collected (they are applied via the window, not here). */
  cutCount: number
}

/** Map a source timestamp to program time, or undefined when it falls in a removed span. */
export const toProgram = (win: CompactedWindow, srcMs: number): number | undefined => {
  for (const r of win.regions) {
    if (srcMs >= r.srcStartMs && srcMs <= r.srcEndMs) return r.progStartMs + (srcMs - r.srcStartMs)
  }
  return undefined
}

/**
 * Nearest program time for a source timestamp that may fall inside a removed span.
 *
 * A note says "around here", not "only if this exact millisecond survives the cut". Without this,
 * a note whose time happened to land in a removed mumble silently vanished — which is exactly what
 * happened once mumble removal was switched on.
 */
export const toProgramNear = (win: CompactedWindow, srcMs: number): number | undefined => {
  const exact = toProgram(win, srcMs)
  if (exact !== undefined) return exact
  let best: { dist: number; prog: number } | undefined
  for (const r of win.regions) {
    const dist = srcMs < r.srcStartMs ? r.srcStartMs - srcMs : srcMs - r.srcEndMs
    const prog = srcMs < r.srcStartMs ? r.progStartMs : r.progStartMs + (r.srcEndMs - r.srcStartMs)
    if (best === undefined || dist < best.dist) best = { dist, prog }
  }
  return best?.prog
}

/**
 * @param notes - stored notes (source time).
 * @param win - the program being rendered.
 * @param clampToEdge - when a note starts in a removed span, clamp to the nearest kept edge
 *   instead of dropping it: the author meant "around here", not "only if this exact millisecond
 *   survives".
 */
export function applyNotes(notes: Note[], win: CompactedWindow, clampToEdge = true): AppliedNotes {
  const out: AppliedNotes = { extraCuts: [], captionSuppressed: [], graphics: [], unhandled: [], cutCount: 0 }

  const mapSpan = (a: number, b: number): [number, number] | undefined => {
    const s = toProgramNear(win, a)
    const e = toProgramNear(win, b)
    if (s !== undefined && e !== undefined) return [s, Math.max(s + 200, e)]
    const first = win.regions[0]
    const last = win.regions[win.regions.length - 1]
    if (first === undefined || last === undefined) return undefined
    // Fully outside this window: drop it. (The inverted form of this test silently dropped every
    // note whose start fell past the END OF THE FIRST REGION, which is almost all of them.)
    if (b < first.srcStartMs || a > last.srcEndMs) return undefined
    if (!clampToEdge) return undefined
    const clampA = Math.min(Math.max(a, first.srcStartMs), last.srcEndMs)
    const clampB = Math.min(Math.max(b, first.srcStartMs), last.srcEndMs)
    const s2 = toProgram(win, clampA)
    const e2 = toProgram(win, clampB)
    return s2 !== undefined && e2 !== undefined ? [s2, Math.max(s2 + 200, e2)] : undefined
  }

  for (const note of notes) {
    if (note.status === 'done') continue
    const span = mapSpan(note.srcStartMs, note.srcEndMs)
    switch (note.kind) {
      case 'cut':
        out.extraCuts.push([note.srcStartMs, note.srcEndMs])
        out.cutCount++
        break
      case 'hide-captions':
        if (span !== undefined) out.captionSuppressed.push(span)
        break
      case 'text-card':
        if (span !== undefined && note.text.trim() !== '') {
          out.graphics.push({
            id: `note-${note.id}`,
            kind: 'text',
            startMs: span[0],
            endMs: span[1],
            layout: 'fullscreen',
            motion: 'fade',
            widthPct: 100,
            text: note.text.trim(),
            accent: '&H0000FFFF',
          })
        }
        break
      case 'image-inset':
        if (span !== undefined && note.asset !== undefined) {
          out.graphics.push({
            id: `note-${note.id}`,
            kind: 'image',
            startMs: span[0],
            endMs: span[1],
            layout: 'inset-tr',
            motion: 'fade',
            widthPct: 34,
            radiusPx: 16,
            src: note.asset,
          })
        }
        break
      case 'free':
        out.unhandled.push(note)
        break
    }
  }

  return out
}
