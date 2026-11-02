import { describe, expect, it } from 'vitest'
import { EDL_SCHEMA_VERSION, Edl } from '../src/schema.js'

/** A minimal but legal EDL: two clips, one caption page, one music bed. */
export function minimalEdl() {
  return {
    schemaVersion: EDL_SCHEMA_VERSION,
    rev: 0,
    projectId: 'prj_test',
    fps: 30,
    clips: [
      {
        id: 'c-01',
        src: 'src-01',
        in: { kind: 'word', word: 'w-0000', offsetMs: -120 },
        out: { kind: 'word', word: 'w-0042', offsetMs: 80 },
        speed: 1,
        role: 'a-roll',
      },
      {
        id: 'c-02',
        src: 'src-01',
        in: { kind: 'time', ms: 12_000 },
        out: { kind: 'time', ms: 15_500 },
        speed: 1.05,
        role: 'a-roll',
      },
    ],
    text: [
      {
        id: 't-101',
        kind: 'caption',
        during: {
          from: { kind: 'word', word: 'w-0010' },
          to: { kind: 'word', word: 'w-0012', offsetMs: 100 },
        },
        words: ['w-0010', 'w-0011', 'w-0012'],
        preset: 'captions-bold-pop',
        box: { anchor: 'below-chin', avoid: ['faces'] },
      },
    ],
    audio: [
      {
        id: 'a-01',
        kind: 'music',
        during: { from: { kind: 'clip', clip: 'c-01', edge: 'start' }, to: { kind: 'clip', clip: 'c-02', edge: 'end' } },
        source: { asset: 'music-bed-a' },
        gainDb: -21,
        duck: { by: 'voice', targetDeltaDb: 20 },
      },
    ],
  }
}

describe('EDL schema', () => {
  it('round-trips a minimal EDL without losing fields', () => {
    const parsed = Edl.parse(minimalEdl())
    expect(parsed.clips).toHaveLength(2)
    expect(parsed.text[0]?.words).toEqual(['w-0010', 'w-0011', 'w-0012'])
    expect(parsed.audio[0]?.duck?.targetDeltaDb).toBe(20)
    // defaults are materialised, so downstream code never sees `undefined` for them
    expect(parsed.text[0]?.box.rotationDeg).toBe(0)
    expect(parsed.visuals).toEqual([])
    // re-parsing the parsed value is stable (idempotent normalisation)
    expect(Edl.parse(parsed)).toEqual(parsed)
  })

  it('rejects an anchor that is not one of the five kinds', () => {
    const bad = minimalEdl()
    // @ts-expect-error deliberately invalid
    bad.clips[0].in = { kind: 'seconds', ms: 100 }
    expect(() => Edl.parse(bad)).toThrow(/anchor|invalid|union/i)
  })

  it('rejects duplicate ids across tracks', () => {
    const dup = minimalEdl()
    dup.text = [{ ...dup.text[0]!, id: 'c-01' } as never]
    const result = Edl.safeParse(dup)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toMatch(/duplicate id c-01/)
  })

  it('rejects a span whose min exceeds its max', () => {
    const bad = minimalEdl()
    bad.text[0]!.during = { ...bad.text[0]!.during, minMs: 900, maxMs: 200 }
    expect(Edl.safeParse(bad).success).toBe(false)
  })

  it('rejects a clip id that does not follow the c-NN convention', () => {
    const bad = minimalEdl()
    bad.clips[0]!.id = 'clip-one'
    expect(Edl.safeParse(bad).success).toBe(false)
  })
})
