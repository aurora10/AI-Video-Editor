/**
 * Word-timing refinement.
 *
 * Why this exists: hosted ASR word timestamps are *contiguous subdivisions* of a
 * segment window, not acoustic alignment. Measured on the reference clip: 546 of 719
 * inter-word gaps are exactly 0 ms, and 6.5 % of words have their midpoint inside
 * detected silence. Captions built on that timing show text over dead air.
 *
 * Two deterministic corrections, no model involved:
 *   1. SNAP — a word that overlaps silence is pushed into the nearest speech region.
 *   2. REDISTRIBUTE — inside each uninterrupted speech run, time is reallocated by
 *      word weight (length + following punctuation), so long words get the room the
 *      speaker actually needed and short ones do not linger.
 *
 * A forced-alignment pass (per-word onset detection on the waveform) can replace step
 * 2 later behind the same interface; on-screen behaviour will only improve.
 */
import { Transcript, type SilenceMap, type Word } from '@dsh-video/core'

export interface RefineOptions {
  /** A gap at least this long separates two speech runs. */
  runGapMs?: number
  /** Minimum on-screen time for any single word. */
  minWordMs?: number
  /** Extra weight for a word followed by a pause punctuation mark. */
  punctuationBonus?: number
}

export interface RefineReport {
  movedOutOfSilence: number
  runs: number
  maxShiftMs: number
  stillInSilence: number
  wordsBefore: number
  wordsAfter: number
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

const weightOf = (word: Word, punctuationBonus: number): number =>
  Math.max(2, word.text.length) + (/[,.;:!?…]$/.test(word.raw) ? punctuationBonus : 0)

export function refineWordTimings(
  transcript: Transcript,
  silence: SilenceMap,
  durationMs: number,
  opts: RefineOptions = {},
): { transcript: Transcript; report: RefineReport } {
  const runGapMs = opts.runGapMs ?? 300
  const minWordMs = opts.minWordMs ?? 120
  const punctuationBonus = opts.punctuationBonus ?? 3
  const speech = speechRegions(silence, durationMs)

  // --- 1. snap every word into a speech region ------------------------------
  let movedOutOfSilence = 0
  let maxShiftMs = 0
  const snapped: Word[] = transcript.words.map((w) => {
    const mid = (w.startMs + w.endMs) / 2
    const inside = speech.find(([s, e]) => mid >= s && mid <= e)
    if (inside !== undefined) return w
    // Nearest region by midpoint distance.
    let best = speech[0]!
    let bestDist = Infinity
    for (const r of speech) {
      const d = mid < r[0] ? r[0] - mid : mid > r[1] ? mid - r[1] : 0
      if (d < bestDist) { bestDist = d; best = r }
    }
    const width = Math.max(minWordMs, w.endMs - w.startMs)
    const startMs = Math.min(Math.max(w.startMs, best[0]), Math.max(best[0], best[1] - width))
    const endMs = Math.min(best[1], startMs + width)
    const shift = Math.abs(startMs - w.startMs)
    if (shift > 0) { movedOutOfSilence += 1; maxShiftMs = Math.max(maxShiftMs, shift) }
    return { ...w, startMs, endMs }
  })

  // --- 2. group into speech runs and redistribute by word weight ------------
  // A run also breaks where a detected silence sits between two words: otherwise the
  // redistribution inside the run can place words back into that silence.
  const silenceBetween = (fromMs: number, toMs: number): boolean =>
    silence.regions.some((r) => r.endMs > 0 && r.startMs < toMs && r.endMs > fromMs)
  const runs: Word[][] = []
  let current: Word[] = []
  for (const w of snapped) {
    const prev = current[current.length - 1]
    if (prev !== undefined && (w.startMs - prev.endMs > runGapMs || silenceBetween(prev.endMs, w.startMs))) {
      runs.push(current)
      current = []
    }
    current.push(w)
  }
  if (current.length > 0) runs.push(current)

  const redistributed: Word[] = runs.flatMap((run) => {
    const first = run[0]!
    const last = run[run.length - 1]!
    const span = Math.max(run.length * minWordMs, last.endMs - first.startMs)
    const totalWeight = run.reduce((n, w) => n + weightOf(w, punctuationBonus), 0)
    let cursor = first.startMs
    return run.map((w, i) => {
      const share = Math.round((weightOf(w, punctuationBonus) / totalWeight) * span)
      const startMs = cursor
      const endMs = i === run.length - 1 ? first.startMs + span : cursor + Math.max(minWordMs, share)
      cursor = endMs
      return { ...w, startMs, endMs }
    })
  })

  const stillInSilence = redistributed.filter((w) => {
    const mid = (w.startMs + w.endMs) / 2
    return silence.regions.some((r) => r.endMs > 0 && mid > r.startMs && mid < r.endMs)
  }).length

  return {
    transcript: { ...transcript, words: redistributed },
    report: {
      movedOutOfSilence,
      runs: runs.length,
      maxShiftMs,
      stillInSilence,
      wordsBefore: transcript.words.length,
      wordsAfter: redistributed.length,
    },
  }
}
