/**
 * OpenAI `whisper-1` adapter.
 *
 * Contract (verified against the API, and the reason the model name is not a free
 * choice): word-level timestamps come from `response_format=verbose_json` plus
 * `timestamp_granularities[]=word` — **the `gpt-4o-transcribe` family does not return
 * word timing**, so swapping the model silently degrades caption accuracy. That check
 * is encoded below rather than left to documentation.
 */
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Transcript, Word } from '@dsh-video/core'
import type { TranscribeOutcome, TranscribeRequest, TranscriptionProvider } from './types.js'

/** OpenAI rejects uploads over 25 MB; stay under it with headroom. */
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024
/** whisper-1 list price per audio minute, USD. Confirm against the billing console. */
const USD_PER_MINUTE = 0.006

export interface OpenAiAsrOptions {
  apiKey: string
  baseUrl?: string
  model?: string
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
  maxRetries?: number
  /** Called with every request attempted, so a cache test can assert zero network. */
  onRequest?: () => void
}

interface VerboseJson {
  task?: string
  language?: string
  duration?: number
  text?: string
  words?: { word: string; start: number; end: number }[]
  segments?: { id?: number; start: number; end: number; text: string }[]
}

export class OpenAiWhisper implements TranscriptionProvider {
  readonly id = 'openai-whisper'
  readonly model: string
  readonly #opts: OpenAiAsrOptions
  #requests = 0

  constructor(opts: OpenAiAsrOptions) {
    this.#opts = opts
    this.model = opts.model ?? 'whisper-1'
    if (!this.model.startsWith('whisper-')) {
      throw new Error(
        `model "${this.model}" does not return word timestamps; only whisper-1 supports ` +
          `timestamp_granularities[]=word. Caption timing depends on them.`,
      )
    }
  }

  /** Requests spent in this process's lifetime. */
  get requests(): number {
    return this.#requests
  }

  async transcribe(req: TranscribeRequest, signal?: AbortSignal): Promise<TranscribeOutcome> {
    const started = Date.now()
    const bytes = (await stat(req.audioPath)).size
    if (bytes > MAX_UPLOAD_BYTES) {
      throw new Error(
        `audio is ${(bytes / 1024 ** 2).toFixed(1)} MB, over the 25 MB upload limit. ` +
          `Remediation: chunk the WAV at silence boundaries and stitch the word lists (the ` +
          `silence map already gives the boundaries).`,
      )
    }

    const form = new FormData()
    const audio = await readFile(req.audioPath)
    form.append('file', new Blob([audio], { type: 'audio/wav' }), basename(req.audioPath))
    form.append('model', this.model)
    form.append('response_format', 'verbose_json')
    // Both granularities: words drive captions, segments drive chapter/reel detection.
    form.append('timestamp_granularities[]', 'word')
    form.append('timestamp_granularities[]', 'segment')
    if (req.language !== undefined) form.append('language', req.language)

    const body = await this.#post(form, signal)
    const words = (body.words ?? []).map((w, i) => toWord(w, i))
    if (words.length === 0) {
      throw new Error('provider returned no word timestamps; caption anchoring is impossible without them')
    }
    const durationMs = req.durationMs || Math.round((body.duration ?? 0) * 1000)

    return {
      requests: 1,
      ms: Date.now() - started,
      transcript: {
        schemaVersion: 1,
        srcId: req.srcId,
        language: body.language ?? req.language ?? 'en',
        provider: 'api',
        model: this.model,
        costUsd: Number(((durationMs / 60_000) * USD_PER_MINUTE).toFixed(6)),
        audioFingerprint: req.audioFingerprint,
        words,
        segments: (body.segments ?? []).map((s, i) => ({
          id: `seg-${String(i).padStart(4, '0')}`,
          startMs: Math.round(s.start * 1000),
          endMs: Math.round(s.end * 1000),
          text: s.text.trim(),
        })),
      } satisfies Transcript,
    }
  }

  async #post(form: FormData, signal?: AbortSignal): Promise<VerboseJson> {
    const doFetch = this.#opts.fetchImpl ?? fetch
    const url = `${this.#opts.baseUrl ?? 'https://api.openai.com/v1'}/audio/transcriptions`
    const maxRetries = this.#opts.maxRetries ?? 3
    let lastError: unknown

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      this.#requests += 1
      this.#opts.onRequest?.()
      let res: Response
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.#opts.apiKey}` },
          body: form,
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (error) {
        lastError = error
        if (signal?.aborted === true) throw error
        await backoff(attempt)
        continue
      }

      if (res.ok) return (await res.json()) as VerboseJson

      const detail = await res.text().catch(() => '')
      // 429 and 5xx are worth retrying; 4xx client errors are not.
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`)
        const retryAfter = Number(res.headers.get('retry-after') ?? 0)
        await backoff(attempt, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined)
        continue
      }
      throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 500)}`)
    }
    throw new Error(`transcription failed after ${maxRetries + 1} attempts: ${String(lastError)}`)
  }
}

const backoff = (attempt: number, overrideMs?: number): Promise<void> =>
  new Promise((r) => setTimeout(r, overrideMs ?? Math.min(8000, 400 * 2 ** attempt)))

/** Map one provider word onto our stable id scheme (`w-0000`, `w-0001`, …). */
export function toWord(w: { word: string; start: number; end: number }, index: number): Word {
  const raw = w.word
  const text = raw.trim().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
  return {
    id: `w-${String(index).padStart(4, '0')}`,
    text,
    raw: raw.trim(),
    startMs: Math.round(w.start * 1000),
    endMs: Math.round(w.end * 1000),
    conf: 1,
  }
}
