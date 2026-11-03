import { describe, expect, it } from 'vitest'
import { detectMumbles, totalCutMs } from '../src/mumbles.js'
import type { SilenceMap, Word } from '../src/analysis.js'

let next = 0
const w = (text: string, startMs: number, endMs: number): Word => ({
  id: `w-${String(next++).padStart(4, '0')}`, text, raw: text, startMs, endMs, conf: 1,
})
/** Build a silence map from pause spans; everything else is speech. */
const sil = (pauses: [number, number][]): SilenceMap => ({
  schemaVersion: 1, srcId: 'src-01', detector: 'test', noiseDb: -30, minDurationMs: 250,
  regions: pauses.map(([a, b]) => ({ startMs: a, endMs: b, kind: 'silence' as const })),
})

describe('mumble detection', () => {
  it('never cuts "это": in Russian it is usually content, not a filler', () => {
    // measured on the reference clip: "это полнейшая чушь", "что это означает", "это не деноминации"
    const words = [w('это', 1000, 1200), w('полнейшая', 1200, 1600), w('чушь', 1600, 1800)]
    const cuts = detectMumbles(words, sil([]), 5000)
    expect(cuts).toHaveLength(0)
  })

  it('cuts an isolated "ну" when a real pause sits beside it', () => {
    // speech before the pause too, so the only candidate is the marker itself
    const words = [w('начали', 1200, 1800), w('Ну', 4000, 4500), w('что', 4700, 4900), w('можно', 4900, 5200)]
    const cuts = detectMumbles(words, sil([[100, 1200], [1800, 4000]]), 8000)
    const discourse = cuts.filter((c) => c.reason === 'discourse')
    expect(discourse).toHaveLength(1)
    expect(discourse[0]).toMatchObject({ startMs: 4000, endMs: 4500 })
  })

  it('keeps a discourse word buried inside a phrase', () => {
    // note: «а» is deliberately NOT used here — as a bare sound it is a genuine hesitation
    const words = [w('тогда', 1000, 1150), w('ну', 1150, 1250), w('ладно', 1250, 1450)]
    expect(detectMumbles(words, sil([]), 3000)).toHaveLength(0)
  })

  it('cuts hesitation sounds wherever they appear', () => {
    const words = [w('эээ', 1000, 1300), w('я', 1300, 1400), w('думаю', 1400, 1700)]
    const cuts = detectMumbles(words, sil([]), 3000)
    expect(cuts).toHaveLength(1)
    expect(cuts[0]?.reason).toBe('hesitation')
  })

  it('cuts a false start where the same word begins twice', () => {
    const words = [w('я', 1000, 1150), w('я', 1200, 1400), w('думаю', 1400, 1700)]
    const cuts = detectMumbles(words, sil([]), 3000)
    expect(cuts.filter((c) => c.reason === 'repeat')).toHaveLength(1)
  })

  it('cuts sound that carries no transcribed words', () => {
    // speech from 0–1000 (a word), 1000–1200 silence, 1200–1700 a mumble with no words
    const words = [w('привет', 200, 900)]
    const cuts = detectMumbles(words, sil([[1000, 1200]]), 2000)
    const bursts = cuts.filter((c) => c.reason === 'untranscribed')
    expect(bursts).toHaveLength(1)
    expect(bursts[0]).toMatchObject({ startMs: 1200, endMs: 2000 })
  })

  it('ignores a burst shorter than the minimum and one longer than the maximum', () => {
    const words = [w('слово', 0, 400)]
    // 100 ms blip after 500 ms silence, and a 3 s stretch (likely content/music)
    const cuts = detectMumbles(words, sil([[400, 500], [600, 3600]]), 6600)
    expect(cuts.filter((c) => c.reason === 'untranscribed')).toHaveLength(0)
  })

  it('reports merged time, not summed overlap', () => {
    const cuts = [
      { startMs: 0, endMs: 500, reason: 'hesitation' as const, detail: '' },
      { startMs: 400, endMs: 900, reason: 'repeat' as const, detail: '' },
      { startMs: 2000, endMs: 2100, reason: 'discourse' as const, detail: '' },
    ]
    expect(totalCutMs(cuts)).toBe(1000)
  })
})
