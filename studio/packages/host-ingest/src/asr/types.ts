/**
 * The transcription seam.
 *
 * Hosted API is the default (ADR-013): better and far faster than CPU whisper on the
 * target hardware. A local adapter stays possible behind the same interface without
 * touching anything downstream.
 */
import type { Transcript } from '@dsh-video/core'

export interface TranscribeRequest {
  /** 16 kHz mono WAV — the ASR-ready extraction, not the 48 kHz mixing copy. */
  audioPath: string
  srcId: string
  /** Fingerprint of the audio file; part of the cache key. */
  audioFingerprint: string
  /** BCP-47 hint when known; omit to let the provider detect. */
  language?: string
  /** Duration used for cost accounting. */
  durationMs: number
}

export interface TranscribeOutcome {
  transcript: Transcript
  /** Network requests actually spent (0 when served from cache). */
  requests: number
  ms: number
}

export interface TranscriptionProvider {
  readonly id: string
  readonly model: string
  transcribe(req: TranscribeRequest, signal?: AbortSignal): Promise<TranscribeOutcome>
}
