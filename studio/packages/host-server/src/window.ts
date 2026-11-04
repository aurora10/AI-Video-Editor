/**
 * Which part of the footage this project is editing.
 *
 * Until now the window was hardcoded to 4:47–5:47 in two places, so every feature built was
 * stranded on one minute of an eight-minute recording. The window belongs to the project.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface EditWindow {
  /** Source time, milliseconds. */
  fromMs: number
  toMs: number
  /** Where it came from, so the pane can say "suggested" vs "chosen". */
  origin: 'default' | 'candidate' | 'manual'
}

export const DEFAULT_WINDOW_MS = 60_000

export async function readWindow(projectsRoot: string, slug: string): Promise<EditWindow> {
  const path = join(projectsRoot, slug, 'project.json')
  const record = JSON.parse(await readFile(path, 'utf8')) as {
    window?: EditWindow
    sources?: { durationMs?: number }[]
  }
  if (record.window !== undefined) return record.window
  // No window recorded yet: take the first minute, or the whole clip when it is shorter.
  const duration = record.sources?.[0]?.durationMs ?? DEFAULT_WINDOW_MS
  return { fromMs: 0, toMs: Math.min(duration, DEFAULT_WINDOW_MS), origin: 'default' }
}

export async function writeWindow(projectsRoot: string, slug: string, win: EditWindow): Promise<EditWindow> {
  const path = join(projectsRoot, slug, 'project.json')
  const record = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown> & { sources?: { durationMs?: number }[] }
  const duration = record.sources?.[0]?.durationMs ?? 0
  if (win.toMs <= win.fromMs) throw new Error('the window end must be after its start')
  if (duration > 0 && win.fromMs >= duration) throw new Error(`the window start is past the end of the footage (${(duration / 1000).toFixed(0)}s)`)
  const clamped: EditWindow = {
    fromMs: Math.max(0, Math.round(win.fromMs)),
    toMs: Math.min(duration > 0 ? duration : win.toMs, Math.round(win.toMs)),
    origin: win.origin,
  }
  record.window = clamped
  await writeFile(path, JSON.stringify(record, null, 2) + '\n')
  return clamped
}

export interface Candidate {
  id: string
  startMs: number
  endMs: number
  durationSec: number
  words: number
  wpm?: number
  deadAirMs?: number
  score?: number
  openingLine?: string
  closingLine?: string
}

export interface AiCandidate {
  id: string
  startMs: number
  endMs: number
  title?: string
  openingLine?: string
  rationale?: string
}

/**
 * Windows proposed by the agent, saved to `edit/candidates.ai.json`.
 *
 * Kept separate from the heuristic candidates (`cut-plan`) so the pane can show both and the owner
 * can see which came from meaning and which from speech density.
 */
export async function readAiCandidates(projectsRoot: string, slug: string): Promise<AiCandidate[]> {
  const path = join(projectsRoot, slug, 'edit', 'candidates.ai.json')
  if (!existsSync(path)) return []
  const data = JSON.parse(await readFile(path, 'utf8')) as { candidates?: AiCandidate[] }
  return (data.candidates ?? []).filter((c) =>
    Number.isFinite(c.startMs) && Number.isFinite(c.endMs) && c.endMs > c.startMs)
}

/** Highlight candidates proposed by `pnpm cut-plan` (optional). */
export async function readCandidates(projectsRoot: string, slug: string): Promise<Candidate[]> {
  const path = join(projectsRoot, slug, 'edit', 'candidates.json')
  if (!existsSync(path)) return []
  const data = JSON.parse(await readFile(path, 'utf8')) as { candidates?: Candidate[] }
  return data.candidates ?? []
}
