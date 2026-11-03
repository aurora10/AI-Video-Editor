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
   * Per-pause retention, overriding `pauseRetainMs` for individual pauses.
   *
   * This is where editorial judgment enters: a stumble deserves a hard cut, while the beat after
   * a claim or a rhetorical question deserves to be kept. A single global number cannot say that,
   * which is why the pace slider alone makes every video feel mechanical.
   */
  pauseRetainOverride?: (pauseSrcMs: number, pauseLengthMs: number) => number | undefined
  /**
   * A kept region shorter than this is not speech worth keeping: it is detector noise
   * (measured: one region came out at 39 ms). Such a sliver is merged into whatever
   * precedes it rather than becoming its own cut.
   */
  minSpeechMs?: number
  /**
   * Additional source spans to remove — mumbles, hesitations, false starts. Treated exactly like
   * a pause, so pacing and word retiming follow automatically.
   */
  extraCuts?: [number, number][]
}

/** Build the pause-free program for the source window `[fromMs, toMs)`. */
export function compactWindow(silence: SilenceMap, fromMs: number, toMs: number, opts: CompactOptions = {}): CompactedWindow {
  const pauseMs = opts.pauseMs ?? 250
  const minSpeechMs = opts.minSpeechMs ?? 200
  const retain = Math.max(0, opts.pauseRetainMs ?? 0)

  // Retention belongs to THE PAUSE ITSELF, decided here and before any merging.
  //
  // Keeping `retain` ms of a pause is identical to cutting from `pauseStart + retain` onward, so
  // each pause becomes a cut of its tail. That removes the earlier contortion of extending a merged
  // region's tail afterwards — which lost the original pause key (so a cut-plan decision could not
  // be found) and halved explicit decisions.
  const pauses = silence.regions
    .filter((r) => r.endMs > 0 && r.endMs - r.startMs >= pauseMs)
    .map((r): [number, number] => [Math.max(fromMs, r.startMs), Math.min(toMs, r.endMs)])
    .filter(([a, b]) => b > a)

  const keptFrom = (pauseStart: number, pauseLen: number): number => {
    const decided = opts.pauseRetainOverride?.(pauseStart, pauseLen)
    const want = decided ?? retain
    // A pace value never eats more than half a pause (keeps quick cuts even); an explicit
    // decision may take the whole pause, because it is a decision rather than a default.
    const limit = decided === undefined ? pauseLen / 2 : pauseLen
    return Math.max(0, Math.min(want, limit))
  }

  const cuts: [number, number][] = [
    ...pauses.map(([a, b]): [number, number] => [a + keptFrom(a, b - a), b]),
    ...(opts.extraCuts ?? []).map(([a, b]): [number, number] => [Math.max(fromMs, a), Math.min(toMs, b)]),
  ].filter(([a, b]) => b > a)

  // merge overlapping cuts
  const mergedCuts: [number, number][] = []
  for (const cut of cuts.sort((a, b) => a[0] - b[0])) {
    const last = mergedCuts[mergedCuts.length - 1]
    if (last !== undefined && cut[0] <= last[1]) last[1] = Math.max(last[1], cut[1])
    else mergedCuts.push([...cut] as [number, number])
  }

  // speech = the complement, dropping slivers that are detector noise
  const rawSpans: [number, number][] = []
  let cursor = fromMs
  for (const [a, b] of mergedCuts) {
    if (a > cursor) rawSpans.push([cursor, a])
    cursor = Math.max(cursor, b)
  }
  if (cursor < toMs) rawSpans.push([cursor, toMs])

  const kept: [number, number][] = []
  for (const span of rawSpans) {
    const prev = kept[kept.length - 1]
    if (span[1] - span[0] < minSpeechMs && prev !== undefined) { prev[1] = span[1]; continue }
    kept.push([...span] as [number, number])
  }

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
