/**
 * The bundled font library.
 *
 * Lives in `core` because two very different consumers need the same list: the renderer (to
 * pick the family and file) and the server (to offer only fonts that exist in the pane). It is
 * pure data, so it costs nothing to share.
 *
 * Every face is an OFL font shipped as a file under `FONT_DIR` — never a system family name,
 * because a substituted face on another machine silently restyles every caption. Each entry is
 * admitted only after `scripts/font-gate.ts` proves it draws the project's script.
 */
export interface FontEntry {
  key: string
  file: string
  /** Family name as the caption renderer must match it. */
  family: string
  label: string
  character: 'clean' | 'rounded' | 'condensed' | 'heavy' | 'caps'
}

export const FONT_DIR = 'fixtures/fonts'

export const FONT_LIBRARY: FontEntry[] = [
  { key: 'inter', file: 'Inter-Variable.ttf', family: 'Inter', label: 'Inter', character: 'clean' },
  { key: 'manrope', file: 'Manrope-Variable.ttf', family: 'Manrope', label: 'Manrope', character: 'rounded' },
  { key: 'oswald', file: 'Oswald-Variable.ttf', family: 'Oswald', label: 'Oswald', character: 'condensed' },
  { key: 'montserrat', file: 'Montserrat-Variable.ttf', family: 'Montserrat', label: 'Montserrat', character: 'heavy' },
  { key: 'bebas', file: 'BebasNeue-Regular.ttf', family: 'Bebas Neue', label: 'Bebas Neue', character: 'caps' },
]

export function findFont(key: string): FontEntry | undefined {
  return FONT_LIBRARY.find((f) => f.key === key)
}

/** Resolve a font key to what the renderer needs, defaulting to the first clean face. */
export function resolveFont(key: string | undefined): { family: string; dir: string; entry: FontEntry } {
  const entry = findFont(key ?? '') ?? FONT_LIBRARY[0]!
  return { family: entry.family, dir: FONT_DIR, entry }
}
