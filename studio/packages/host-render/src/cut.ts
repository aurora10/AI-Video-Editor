/**
 * Program-time compaction: turn a window of the source into a pause-free cut.
 *
 * This is the smallest honest version of the resolver. A kept region is a span of source
 * time that survives; program time is what the viewer experiences after the pauses are
 * gone. Words, captions and overlays must all be expressed in program time, which is why
 * the mapping is a function rather than an ad-hoc offset.
 */
import type { SilenceMap, Word } from '@dsh-video/core'

export interface KeptRegion {
  srcStartMs: number
  srcEndMs: number
  progStartMs: number
}

export interface CompactedWindow {
  regions: KeptRegion[]
  programDurationMs: number
  /** Map a source timestamp into program time (clamped into the nearest kept region). */
  toProgram: (srcMs: number) => number
  removedMs: number
}

export interface CompactOptions {
  /** Pauses at least this long are removed. */
  pauseMs?: number
  /**
   * Milliseconds of each pause to keep as breathing room.
   *
   * Zero gives the tightest cut (a jump cut on every pause, which reads as rushed); a couple of
   * hundred milliseconds lets the viewer land between thoughts. This is the "pace" setting.
   */
  pauseRetainMs?: number
  /**
   * A kept region shorter than this is not speech worth keeping: it is detector noise
   * (measured: one region came out at 39 ms). Such a sliver is merged into whatever
   * precedes it rather than becoming its own cut.
   */
  minSpeechMs?: number
}

/** Build the pause-free program for the source window `[fromMs, toMs)`. */
export function compactWindow(silence: SilenceMap, fromMs: number, toMs: number, opts: CompactOptions = {}): CompactedWindow {
  const pauseMs = opts.pauseMs ?? 250
  const pauses = silence.regions
    .filter((r) => r.endMs > 0 && r.endMs - r.startMs >= pauseMs)
    .map((r) => [Math.max(fromMs, r.startMs), Math.min(toMs, r.endMs)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0])

  const minSpeechMs = opts.minSpeechMs ?? 200
  const retain = Math.max(0, opts.pauseRetainMs ?? 0)

  // 1. speech spans = everything that is not a pause
  const rawSpans: [number, number][] = []
  let cursor = fromMs
  for (const [a, b] of pauses) {
    if (a > cursor) rawSpans.push([cursor, a])
    cursor = Math.max(cursor, b)
  }
  if (cursor < toMs) rawSpans.push([cursor, toMs])

  // 2. drop detector noise: a span shorter than minSpeechMs merges into its predecessor
  const merged: [number, number][] = []
  for (const span of rawSpans) {
    const prev = merged[merged.length - 1]
    if (span[1] - span[0] < minSpeechMs && prev !== undefined) { prev[1] = span[1]; continue }
    merged.push([...span] as [number, number])
  }

  // 3. pacing: extend each span's tail into the following pause, never past the midpoint of that
  //    gap. Done AFTER merging, so the breath cannot be swallowed by the sliver rule — doing it
  //    first made "calm" shorter than "normal", which is how this was caught.
  const kept: [number, number][] = merged.map((span, i) => {
    const next = merged[i + 1]
    if (next === undefined || retain === 0) return span
    const gap = next[0] - span[1]
    return [span[0], span[1] + Math.min(retain, gap / 2)]
  })

  const regions: KeptRegion[] = []
  let program = 0
  for (const [a, b] of kept) {
    regions.push({ srcStartMs: a, srcEndMs: b, progStartMs: program })
    program += b - a
  }

  const toProgram = (srcMs: number): number => {
    if (regions.length === 0) return 0
    for (const r of regions) {
      if (srcMs < r.srcStartMs) return r.progStartMs
      if (srcMs <= r.srcEndMs) return r.progStartMs + (srcMs - r.srcStartMs)
    }
    const last = regions[regions.length - 1]!
    return last.progStartMs + (last.srcEndMs - last.srcStartMs)
  }

  return { regions, programDurationMs: program, toProgram, removedMs: toMs - fromMs - program }
}

/** Shift words into program time and drop the ones outside the window. */
export function shiftWords(words: Word[], win: CompactedWindow, fromMs: number, toMs: number): Word[] {
  return words
    .filter((w) => w.endMs > fromMs && w.startMs < toMs)
    .map((w) => ({
      ...w,
      startMs: win.toProgram(Math.max(fromMs, w.startMs)),
      endMs: win.toProgram(Math.min(toMs, w.endMs)),
    }))
    .filter((w) => w.endMs > w.startMs)
}

/**
 * One `select` expression over source timestamps, used for both streams.
 *
 * A per-region trim+concat graph needs two labels per region and fails outright on a
 * sliver shorter than a frame. A single selection expression has neither problem and the
 * timestamps are already the source's own.
 */
export function compactSelectExpr(win: CompactedWindow): string {
  // An EMPTY expression is not an error to ffmpeg: `select=''` selects every frame, so a
  // degenerate window (zero length, reversed, or entirely inside a pause) rendered the whole
  // source and reported success. `0` selects nothing, which fails loudly downstream.
  if (win.regions.length === 0) return '0'
  return win.regions
    .map((r) => `between(t,${(r.srcStartMs / 1000).toFixed(3)},${(r.srcEndMs / 1000).toFixed(3)})`)
    .join('+')
}
