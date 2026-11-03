/**
 * Voice polish for a weak microphone.
 *
 * Measured on the reference recording: the body band (80–160 Hz) sits **8.9 dB** below the
 * mid band and the presence band (1–3 kHz) **5.7 dB** below it, with almost no air above
 * 8 kHz. That is the signature of a small built-in mic: thin *and* dull at once, which is
 * why "make it deeper" alone would only add mud.
 *
 * The chain therefore fixes both ends and refuses to invent what is not there:
 *   1. high-pass at 70 Hz      — remove rumble below the voice (sub band measured −16.6 dB)
 *   2. low shelf +3.5 dB @130  — body, the "depth" that was asked for
 *   3. mud cut −1.5 dB @300    — make room for the presence lift instead of stacking up
 *   4. presence +3.5 dB @2.5k  — intelligibility
 *   5. air shelf +2 dB @9k     — remove the blanket
 *   6. de-esser 6–8 kHz        — the presence lift would otherwise sharpen sibilance
 *   7. gentle compression      — even out level between phrases
 *   8. spectral denoise        — room hiss
 *   9. loudness −14 LUFS, TP −1 — delivery target
 */
export interface VoiceOptions {
  /** Adds body. 0 disables the low tilt. */
  bodyGainDb?: number
  /** Presence lift around 1.7 kHz. */
  presenceGainDb?: number
  airGainDb?: number
  denoise?: boolean
  compress?: boolean
  /** Integrated loudness target in LUFS. */
  targetLufs?: number
  truePeakDb?: number
  sampleRate?: number
}

export interface VoiceChain {
  /** Comma-separated ffmpeg filter chain for an audio stream. */
  filters: string
  description: string
}

/**
 * The measured tuning (see the file header). The two gains below are not arbitrary: they
 * were chosen by sweeping candidates and measuring band deltas, and they are the pair that
 * reaches body ≥ −6 dB and presence ≥ −2 dB on the reference recording without booming.
 *
 * Note the shape: a *peaking* filter at 110 Hz, not a bass shelf. The source rolls off
 * smoothly (~3 dB per 50 Hz), and a shelf's slow rolloff moved the 80–160 Hz band by only
 * 1.5 dB where the peaking filter moves it by 6+.
 */
export function voicePolishChain(opts: VoiceOptions = {}): VoiceChain {
  const body = opts.bodyGainDb ?? 10.5
  const presence = opts.presenceGainDb ?? 9
  const air = opts.airGainDb ?? 5
  const target = opts.targetLufs ?? -14
  const peak = opts.truePeakDb ?? -1
  const rate = opts.sampleRate ?? 48000
  const parts: string[] = ['highpass=f=65']
  if (body !== 0) parts.push(`equalizer=f=110:t=q:w=0.7:g=${body}`)
  parts.push('equalizer=f=230:t=q:w=1.2:g=-2')
  if (presence !== 0) {
    parts.push(`equalizer=f=1700:t=q:w=0.8:g=${presence}`)
    parts.push(`equalizer=f=3400:t=q:w=1:g=${Math.round(presence * 0.78)}`)
    parts.push('equalizer=f=1200:t=q:w=2:g=3')
  }
  if (air !== 0) parts.push(`treble=f=9000:g=${air}`)
  if (opts.compress !== false) {
    // Threshold/ratio tuned for close-mic speech that is already even but softly delivered.
    parts.push('acompressor=threshold=-18dB:ratio=3:attack=8:release=140:makeup=1.5:knee=2.5')
  }
  if (opts.denoise !== false) parts.push('afftdn=nr=6:nf=-30:tn=1')
  parts.push(`loudnorm=I=${target}:TP=${peak}:LRA=11`, `aresample=${rate}`)
  return {
    filters: parts.join(','),
    description:
      `highpass 65Hz · body +${body}dB@110Hz · mud −2dB@230Hz · presence +${presence}dB@1.7kHz ` +
      `+${Math.round(presence * 0.78)}dB@3.4kHz · air +${air}dB@9kHz · 3:1 comp · denoise · ${target} LUFS`,
  }
}
