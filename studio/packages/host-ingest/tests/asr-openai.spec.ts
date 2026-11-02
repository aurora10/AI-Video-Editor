import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { OpenAiWhisper, toWord } from '../src/asr/openai.js'
import { parseSilencedetect } from '../src/silence.js'

/** A minimal verbose_json body shaped exactly like the provider's response. */
const VERBOSE_JSON = {
  task: 'transcribe',
  language: 'english',
  duration: 4.2,
  text: 'So the whole point is that.',
  words: [
    { word: ' So', start: 0.0, end: 0.28 },
    { word: ' the', start: 0.28, end: 0.52 },
    { word: ' whole', start: 0.52, end: 0.9 },
    { word: ' point.', start: 0.9, end: 1.4 },
    { word: " It's", start: 2.6, end: 3.0 },
  ],
  segments: [
    { id: 0, start: 0, end: 1.6, text: ' So the whole point.' },
    { id: 1, start: 2.6, end: 4.2, text: " It's done." },
  ],
}

let dir: string
let wav: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'asr-'))
  wav = join(dir, 'audio-16k-mono.wav')
  await writeFile(wav, Buffer.alloc(2048))
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

const okFetch = (body: unknown = VERBOSE_JSON) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))

describe('OpenAI whisper adapter', () => {
  it('refuses a model that cannot return word timestamps', () => {
    expect(() => new OpenAiWhisper({ apiKey: 'k', model: 'gpt-4o-transcribe' })).toThrow(/word timestamps/i)
  })

  it('maps a verbose_json response to a validated transcript with stable word ids', async () => {
    const provider = new OpenAiWhisper({ apiKey: 'test-key', fetchImpl: okFetch() as unknown as typeof fetch })
    const out = await provider.transcribe({
      audioPath: wav, srcId: 'src-01', audioFingerprint: 'fp123', durationMs: 4200,
    })

    const t = out.transcript
    expect(t.words).toHaveLength(5)
    expect(t.words[0]).toMatchObject({ id: 'w-0000', text: 'So', raw: 'So', startMs: 0, endMs: 280 })
    expect(t.words[3]).toMatchObject({ id: 'w-0003', text: 'point', raw: 'point.' })
    expect(t.words[4]).toMatchObject({ id: 'w-0004', text: "It's" })
    expect(t.segments).toHaveLength(2)
    expect(t.segments[1]).toMatchObject({ id: 'seg-0001', startMs: 2600, endMs: 4200 })
    expect(t.provider).toBe('api')
    expect(t.model).toBe('whisper-1')
    // 4.2s of audio at $0.006/min
    expect(t.costUsd).toBeCloseTo(0.00042, 6)
    expect(out.requests).toBe(1)
  })

  it('sends the granularities the caption pipeline depends on', async () => {
    const fetchImpl = okFetch()
    const provider = new OpenAiWhisper({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })
    await provider.transcribe({ audioPath: wav, srcId: 'src-01', audioFingerprint: 'fp', durationMs: 4200 })
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const form = call[1].body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.getAll('timestamp_granularities[]')).toEqual(['word', 'segment'])
  })

  it('retries a 5xx, then succeeds', async () => {
    let n = 0
    const fetchImpl = vi.fn(async () => {
      n += 1
      if (n === 1) return new Response('upstream hiccup', { status: 503 })
      return new Response(JSON.stringify(VERBOSE_JSON), { status: 200 })
    })
    const provider = new OpenAiWhisper({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch, maxRetries: 2 })
    const out = await provider.transcribe({ audioPath: wav, srcId: 's', audioFingerprint: 'f', durationMs: 1000 })
    expect(out.requests).toBe(1)
    expect(provider.requests).toBe(2)
  })

  it('does not retry a 4xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad key', { status: 401 }))
    const provider = new OpenAiWhisper({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(provider.transcribe({ audioPath: wav, srcId: 's', audioFingerprint: 'f', durationMs: 1000 }))
      .rejects.toThrow(/401/)
    expect(provider.requests).toBe(1)
  })

  it('fails loudly when the provider returns no words', async () => {
    const provider = new OpenAiWhisper({ apiKey: 'k', fetchImpl: okFetch({ ...VERBOSE_JSON, words: [] }) as unknown as typeof fetch })
    await expect(provider.transcribe({ audioPath: wav, srcId: 's', audioFingerprint: 'f', durationMs: 1000 }))
      .rejects.toThrow(/no word timestamps/i)
  })
})

describe('word mapping', () => {
  it('strips edge punctuation but keeps internal apostrophes', () => {
    expect(toWord({ word: ' "Hello,', start: 0, end: 1 }, 7).text).toBe('Hello')
    expect(toWord({ word: "don't.", start: 0, end: 1 }, 8).text).toBe("don't")
  })
})

describe('silencedetect parsing', () => {
  it('pairs start/end and leaves a trailing pause open', () => {
    const log = [
      '[silencedetect @ 0x1] silence_start: 12.345',
      '[silencedetect @ 0x1] silence_end: 13.678 | silence_duration: 1.333',
      '[silencedetect @ 0x1] silence_start: 40.5',
    ].join('\n')
    expect(parseSilencedetect(log)).toEqual([
      { startMs: 12345, endMs: 13678, kind: 'silence' },
      { startMs: 40500, endMs: -1, kind: 'silence' },
    ])
  })
})
