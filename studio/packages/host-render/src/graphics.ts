/**
 * Compositing the graphics track over the picture.
 *
 * Two mechanisms, chosen per kind because ffmpeg is much better at one than the other:
 *   - `text` graphics become a second ASS document (positioning and typography are what ASS is
 *     for; drawtext escaping is a well of pain);
 *   - `image` / `video` graphics are overlay filters with a `between(t,…)` enable window.
 *
 * Times are program time, the timeline the viewer actually experiences.
 */
import type { Graphic, GraphicsTrack } from '@dsh-video/core'

export interface GraphicsPlan {
  /** Extra ffmpeg inputs to append after the audio input. */
  extraInputs: string[]
  /** Filter statements to place after the base video label; returns the new label. */
  statements: string[]
  /** ASS document for text graphics, when any exist. */
  textAss: string | null
  /**
   * The label carrying the picture after every overlay. Returned rather than derived: each
   * graphic emits two statements, so counting statements to guess the last label produces the
   * wrong one ("Invalid stream specifier: gb2").
   */
  finalLabel: string
}

export interface GraphicsOptions {
  width: number
  height: number
  fontFamily: string
  fontDir: string
  /** Margin from the frame edge for inset layouts. */
  insetPct?: number
  scale?: { x: number; y: number; ox: number; oy: number }
}

const assTime = (ms: number): string => {
  const t = Math.max(0, ms)
  const h = Math.floor(t / 3_600_000)
  const m = Math.floor((t % 3_600_000) / 60_000)
  const s = Math.floor((t % 60_000) / 1000)
  const cs = Math.floor((t % 1000) / 10)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** Where an inset sits, in output pixels. */
export function insetBox(layout: Graphic['layout'], width: number, height: number, widthPct: number, insetPct = 0.05): { x: number; y: number; w: number; h: number } {
  const w = Math.round((width * widthPct) / 100 / 2) * 2
  const h = w // square insets; a source with another aspect is fitted at scale time
  const mx = Math.round(width * insetPct)
  const my = Math.round(height * insetPct)
  switch (layout) {
    case 'inset-tl': return { x: mx, y: my, w, h }
    case 'inset-bl': return { x: mx, y: height - h - my, w, h }
    case 'inset-br': return { x: width - w - mx, y: height - h - my, w, h }
    case 'fullscreen': return { x: 0, y: 0, w: width, h: height }
    case 'inset-tr':
    default: return { x: width - w - mx, y: my, w, h }
  }
}

/**
 * Build the graphics pass.
 * @param track - validated graphics track.
 * @param baseLabel - the video label the graphics compose onto.
 * @param opts - output geometry and fonts.
 * @returns inputs to append, filter statements, and the text ASS document.
 */
export function planGraphics(track: GraphicsTrack, baseLabel: string, opts: GraphicsOptions): GraphicsPlan {
  const extraInputs: string[] = []
  const statements: string[] = []
  const textEvents: string[] = []
  let label = baseLabel
  let inputIndex = 2 // 0 = picture proxy, 1 = audio master
  let n = 0

  for (const g of track.graphics) {
    const box = insetBox(g.layout, opts.width, opts.height, g.widthPct)
    const enable = `between(t,${(g.startMs / 1000).toFixed(3)},${(g.endMs / 1000).toFixed(3)})`

    if (g.kind === 'text') {
      // Text goes into the ASS pass; alignment per layout, accent for the main line.
      const alignment = g.layout === 'lower-third' ? 2 : g.layout === 'fullscreen' ? 5 : 9
      const marginV = g.layout === 'lower-third' ? Math.round(opts.height * 0.12) : Math.round(opts.height * 0.06)
      const main = `{\\c${g.accent}}${g.text}`
      const sub = g.subtext === undefined ? '' : `\\N{\\c&H00FFFFFF&\\fs${Math.round(opts.height * 0.028)}}${g.subtext}`
      textEvents.push(
        `Dialogue: 0,${assTime(g.startMs)},${assTime(g.endMs)},Graphic,,0,0,${marginV},,${main}${sub}`,
      )
      void alignment
      continue
    }

    extraInputs.push('-i', g.src)
    const idx = inputIndex
    inputIndex++
    const out = `g${n++}`

    if (g.kind === 'image') {
      statements.push(`[${idx}:v]scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease,format=rgba[${out}s]`)
    } else {
      const from = (g.srcStartMs / 1000).toFixed(3)
      const to = ((g.srcStartMs + (g.endMs - g.startMs)) / 1000).toFixed(3)
      statements.push(
        `[${idx}:v]trim=start=${from}:end=${to},setpts=PTS-STARTPTS,scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease,format=rgba[${out}s]`,
      )
    }
    const next = `gb${n}`
    statements.push(`[${label}][${out}s]overlay=x=${box.x}:y=${box.y}:enable='${enable}':format=auto[${next}]`)
    label = next
  }

  let textAss: string | null = null
  if (textEvents.length > 0) {
    textAss = [
      '[Script Info]',
      'ScriptType: v4.00+',
      `PlayResX: ${opts.width}`,
      `PlayResY: ${opts.height}`,
      'WrapStyle: 2',
      'ScaledBorderAndShadow: yes',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Graphic,${opts.fontFamily},${Math.round(opts.height * 0.042)},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,0,2,48,48,${Math.round(opts.height * 0.12)},1`,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...textEvents,
    ].join('\n') + '\n'
  }

  return { extraInputs, statements, textAss, finalLabel: label }
}
