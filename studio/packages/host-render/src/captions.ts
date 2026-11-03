/**
 * Caption pages: from refined word timings to burnable ASS.
 *
 * The rules encoded here are the ones a human editor applies, not a word count:
 *  - a page holds a *meaning*, so a preposition, a negation, a number, a name or an
 *    article is never orphaned at the end of a page;
 *  - page length is decided by the measured room the text needs at delivery size, so
 *    long Cyrillic words do not overflow a 1080-px frame;
 *  - a page may wrap to two lines, and only two;
 *  - karaoke is an explicit choice (only the current word lit, or spoken words stay lit).
 *
 * Width is estimated from per-character advances rather than measured from the font
 * binary: it is deterministic, needs no font parser in the hot path, and errs on the
 * conservative side. `scripts/verify-captions.ts` checks the *rendered* bounding box so
 * the estimate cannot silently drift.
 */
import type { Word } from '@dsh-video/core'

export interface CaptionStyle {
  /** Font family name as libass knows it (e.g. "Arial"), plus the directory holding the file. */
  fontFamily: string
  fontDir: string
  sizePx: number
  primary: string
  outline: string
  outlinePx: number
  shadowPx: number
  bold: boolean
  /** Fraction of frame width captions may occupy. */
  maxWidthPct: number
  /** Fraction of frame height kept clear at the bottom. */
  bottomInsetPct: number
  /** Hard cap; a page that would need more lines is split earlier instead. */
  maxLines: number
  /**
   * `none`   — the whole phrase, plainly.
   * `word`   — one word alone on screen at a time, large.
   * `phrase` — the phrase stays visible and the *currently spoken* word is accented and
   *            slightly enlarged (the short-form karaoke read).
   */
  karaoke: 'none' | 'word' | 'phrase'
  uppercase: boolean
  /** Accent colour for the active word, ASS &HAABBGGRR. Default: yellow. */
  accent?: string
  /** Scale applied to the active word, percent. */
  accentScalePct?: number
}

export const DEFAULT_CYRILLIC_CAPTION_STYLE: CaptionStyle = {
  fontFamily: 'Arial',
  fontDir: '/System/Library/Fonts/Supplemental',
  sizePx: 86,
  primary: '&H00FFFFFF',
  outline: '&H00000000',
  outlinePx: 6,
  shadowPx: 0,
  bold: true,
  maxWidthPct: 0.86,
  bottomInsetPct: 0.2,
  maxLines: 2,
  karaoke: 'phrase',
  uppercase: false,
  accent: '&H0000FFFF',
  accentScalePct: 112,
}

/** Words that must not end a page: they belong to what follows. */
const GLUE_TO_NEXT = new Set([
  // Russian prepositions, conjunctions, negations, particles
  'в', 'во', 'на', 'с', 'со', 'к', 'ко', 'по', 'у', 'о', 'об', 'обо', 'из', 'изо', 'от', 'ото',
  'до', 'для', 'при', 'про', 'за', 'под', 'подо', 'над', 'надо', 'без', 'безо', 'через', 'между',
  'перед', 'передо', 'около', 'после', 'кроме', 'сквозь', 'ради', 'благодаря', 'вопреки',
  'не', 'ни', 'и', 'а', 'но', 'или', 'либо', 'что', 'чтобы', 'как', 'когда', 'если', 'чем',
  'это', 'этот', 'эта', 'эти', 'тот', 'та', 'те', 'мой', 'моя', 'мои', 'наш', 'наша', 'ваш',
  // English equivalents, since the same pipeline serves both
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'and', 'or',
  'not', 'is', 'are', 'was', 'were', 'that', 'this', 'as', 'if', 'than',
])

/** Rough advance width in em units, by character class. Deliberately conservative. */
function advanceEm(ch: string): number {
  if (ch === ' ') return 0.28
  if ('iíjltI1.,:;\'’!|'.includes(ch)) return 0.30
  if ('mwMWШЩЖМЫЮФ'.includes(ch)) return 0.88
  if ('—–'.includes(ch)) return 0.62
  if (/[A-ZА-ЯЁ]/.test(ch)) return 0.68
  return 0.56
}

export function estimateWidthPx(text: string, style: CaptionStyle): number {
  let em = 0
  for (const ch of text) em += advanceEm(ch)
  // bold text runs slightly wider; letterspacing is ignored (0), the outline adds a little
  const boldFactor = style.bold ? 1.04 : 1
  return em * style.sizePx * boldFactor + style.outlinePx * 2
}

export interface CaptionPage {
  startMs: number
  endMs: number
  words: Word[]
  lines: string[]
  widthPx: number
  /** Pixels from the top of the frame to the first line, after face-aware placement. */
  topPx?: number
  /** Font size actually used for this page, when it had to shrink to fit below the chin. */
  sizePx?: number
}

const wordText = (w: Word, style: CaptionStyle): string => (style.uppercase ? w.text.toUpperCase() : w.text)

/**
 * Split a page's words into at most `maxLines` lines at the best available break,
 * preferring a break that keeps each line within the width budget.
 */
function wrapLines(words: Word[], style: CaptionStyle, frameWidth: number): { lines: string[]; widthPx: number } {
  const budget = frameWidth * style.maxWidthPct
  const texts = words.map((w) => wordText(w, style))
  const full = texts.join(' ')
  if (estimateWidthPx(full, style) <= budget || words.length === 1) {
    return { lines: [full], widthPx: estimateWidthPx(full, style) }
  }
  if (style.maxLines < 2) return { lines: [full], widthPx: estimateWidthPx(full, style) }

  // choose the split index whose longest line is narrowest, preferring balance
  let best = { index: 1, score: Infinity }
  for (let i = 1; i < texts.length; i++) {
    const a = estimateWidthPx(texts.slice(0, i).join(' '), style)
    const b = estimateWidthPx(texts.slice(i).join(' '), style)
    const score = Math.max(a, b)
    if (score < best.score) best = { index: i, score }
  }
  const line1 = texts.slice(0, best.index).join(' ')
  const line2 = texts.slice(best.index).join(' ')
  return { lines: [line1, line2], widthPx: Math.max(estimateWidthPx(line1, style), estimateWidthPx(line2, style)) }
}

export interface PlanOptions {
  frameWidth: number
  style?: CaptionStyle
  /** Grouping target: words per page before width fitting. 2–5 reads well. */
  targetWordsPerPage?: number
  /**
   * Horizontal/vertical placement for the whole run, in pixels from the top of the frame.
   *
   * Deliberately COULD-BE-CONSTANT: typography must not move or resize between pages. An
   * earlier version sized and placed each page from the chin at that instant, which made the
   * type visibly change size as the speaker's head moved — the viewer reads that as a bug.
   * The stable number comes from the median chin across the run (see render-clip), and pages
   * adapt by carrying fewer words rather than by shrinking.
   */
  place?: { topPx: number; maxBottomPx: number }
}

/**
 * Group refined words into caption pages.
 *
 * Two passes: accumulate a page by target size, then *repair the boundary* so a
 * glue-word never dangles at the end of a page.
 */
export function planCaptionPages(words: Word[], opts: PlanOptions): CaptionPage[] {
  const style = opts.style ?? DEFAULT_CYRILLIC_CAPTION_STYLE
  const target = opts.targetWordsPerPage ?? 4
  const budget = opts.frameWidth * style.maxWidthPct

  const pages: Word[][] = []
  let current: Word[] = []
  for (const w of words) {
    const candidate = [...current, w]
    const text = candidate.map((x) => wordText(x, style)).join(' ')
    const tooLong = estimateWidthPx(text, style) > budget && current.length > 0
    if (current.length >= target || tooLong) {
      pages.push(current)
      current = [w]
    } else {
      current = candidate
    }
  }
  if (current.length > 0) pages.push(current)

  // boundary repair: a glue-word may not be the last word of a page
  for (let i = 0; i < pages.length - 1; i++) {
    const page = pages[i]!
    const last = page[page.length - 1]
    if (last !== undefined && GLUE_TO_NEXT.has(last.text.toLowerCase()) && page.length > 1) {
      const moved = page.pop()!
      pages[i + 1]!.unshift(moved)
    }
  }

  return pages
    .filter((p) => p.length > 0)
    .map((p) => {
      const { lines, widthPx } = wrapLines(p, style, opts.frameWidth)
      const page: CaptionPage = { startMs: p[0]!.startMs, endMs: p[p.length - 1]!.endMs, words: p, lines, widthPx }
      if (opts.place === undefined) return page
      return { ...page, topPx: opts.place.topPx }
    })
}

const assTime = (ms: number): string => {
  const total = Math.max(0, ms)
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const cs = Math.floor((total % 1000) / 10)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export interface AssOptions {
  width: number
  height: number
  style?: CaptionStyle
  /** Line break inside a page: libass `\N` (hard) keeps authored wrapping. */
  pageSeparator?: string
}

/** Emit a complete ASS document. Time base is the page's own program time. */
export function toAss(pages: CaptionPage[], opts: AssOptions): string {
  const style = opts.style ?? DEFAULT_CYRILLIC_CAPTION_STYLE
  const marginV = Math.round(opts.height * style.bottomInsetPct)
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment 8 = top-center: pages grow downward from an explicit top, so a face-anchored
    // position is exact instead of inferred from the bottom margin.
    `Style: Cap,${style.fontFamily},${style.sizePx},${style.primary},&H000000FF,${style.outline},&H64000000,${style.bold ? -1 : 0},0,0,0,100,100,0,0,1,${style.outlinePx},${style.shadowPx},8,40,40,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  // A caption holds until the next one appears. Without this the screen goes blank between
  // pages, which the eye reads as flicker; speech pauses are already removed from the
  // program, so holding never covers dead air for long.
  const displayEnd = (i: number): number => pages[i + 1]?.startMs ?? pages[i]!.endMs
  const events = pages.flatMap((page, i) => {
    const pageEnd = displayEnd(i)
    const size = page.sizePx ?? style.sizePx
    const top = page.topPx === undefined ? marginV : Math.round(page.topPx)
    const line = page.lines.join('\\N')

    if (style.karaoke === 'none') {
      return [`Dialogue: 0,${assTime(page.startMs)},${assTime(pageEnd)},Cap,,0,0,${top},,${size === style.sizePx ? '' : `{\\fs${size}}`}${line}`]
    }

    if (style.karaoke === 'word') {
      // One word alone on screen. Each word HOLDS until the next one starts — cutting the
      // dialogue at the word's own end leaves the screen empty between words, which reads
      // as flicker rather than rhythm.
      return page.words.map((w, i) => {
        const next = page.words[i + 1]
        const end = next === undefined ? pageEnd : next.startMs
        // no per-line size override: the page's size IS the style size, so the document
        // carries exactly one font size and the type cannot drift between words
        const tag = size === style.sizePx ? '' : `{\\fs${size}}`
        return `Dialogue: 0,${assTime(w.startMs)},${assTime(Math.max(end, w.endMs))},Cap,,0,0,${top},,${tag}${wordText(w, style)}`
      })
    }

    // 'phrase': the whole phrase stays up; only the active word is accented and enlarged.
    // One dialogue per word state — the redraw is what makes the accent move.
    const accent = style.accent ?? '&H0000FFFF'
    const scale = style.accentScalePct ?? 112
    const states: { startMs: number; endMs: number; active: number }[] = []
    page.words.forEach((w, k) => states.push({ startMs: w.startMs, endMs: w.endMs, active: k }))
    // Fill the gaps between words so the phrase never blinks out.
    for (let i = 0; i < page.words.length - 1; i++) {
      const gapStart = page.words[i]!.endMs
      const gapEnd = page.words[i + 1]!.startMs
      if (gapEnd - gapStart > 20) states.push({ startMs: gapStart, endMs: gapEnd, active: i })
    }
    // the final word-state holds to the next page
    const lastState = states[states.length - 1]
    if (lastState !== undefined) lastState.endMs = Math.max(lastState.endMs, pageEnd)
    states.sort((a, b) => a.startMs - b.startMs)

    return states.map(({ startMs, endMs, active }) => {
      const text = page.words
        .map((w, i) => {
          const word = wordText(w, style)
          if (i === active) return `{\\c${accent}\\fscx${scale}\\fscy${scale}}${word}{\\c${style.primary}\\fscx100\\fscy100}`
          return word
        })
        .join(' ')
      const sizeTag = size === style.sizePx ? '' : `{\\fs${size}}`
      return `Dialogue: 0,${assTime(startMs)},${assTime(endMs)},Cap,,0,0,${top},,${sizeTag}${text}`
    })
  })

  return [...header, ...events].join('\n') + '\n'
}

