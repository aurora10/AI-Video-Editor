/**
 * Note storage and the program↔source conversion the pane depends on.
 *
 * The pane thinks in program time (what the viewer sees). Notes are stored in source time so a
 * re-cut cannot move them. The conversion uses the region table that every render publishes in
 * its sidecar — the same table the verifiers use, so the pane and the renderer cannot disagree
 * about where a second is.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Note } from '@dsh-video/core'

export interface Region { srcStartMs: number; srcEndMs: number; progStartMs: number }

interface RenderMeta {
  programMs?: number
  regions?: Region[]
}

export interface TimelineInfo {
  /** Length of the last render, in program time. */
  programMs: number
  /** Source length, for reference. */
  sourceMs: number
  /** The last render's window start, in source time. */
  windowFromMs: number
  hasTimeline: boolean
}

/**
 * Timeline geometry for the pane.
 *
 * Reads the same `render/regions.json` that note authoring converts through, so the ruler the
 * user clicks on and the mapping that stores the note cannot disagree — reading the meta sidecar
 * here while converting through the regions file was two sources of truth for the same fact.
 */
export async function readTimeline(projectsRoot: string, slug: string): Promise<TimelineInfo> {
  const empty: TimelineInfo = { programMs: 0, sourceMs: 0, windowFromMs: 0, hasTimeline: false }
  const path = join(projectsRoot, slug, 'render', 'regions.json')
  if (!existsSync(path)) return empty
  const data = JSON.parse(await readFile(path, 'utf8')) as { programMs?: number; regions?: Region[] }
  const regions = data.regions ?? []
  return {
    programMs: data.programMs ?? 0,
    sourceMs: 0,
    windowFromMs: regions[0]?.srcStartMs ?? 0,
    hasTimeline: regions.length > 0,
  }
}

const notesPath = (projectsRoot: string, slug: string): string => join(projectsRoot, slug, 'edit', 'notes.jsonl')

export async function readNotes(projectsRoot: string, slug: string): Promise<Note[]> {
  const path = notesPath(projectsRoot, slug)
  if (!existsSync(path)) return []
  const lines = (await readFile(path, 'utf8')).split('\n').filter((l) => l.trim() !== '')
  const out: Note[] = []
  for (const line of lines) {
    // A hand-edited or older line must not take the whole list down.
    const parsed = Note.safeParse(JSON.parse(line))
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

async function writeNotes(projectsRoot: string, slug: string, notes: Note[]): Promise<void> {
  await writeFile(notesPath(projectsRoot, slug), notes.map((n) => JSON.stringify(n)).join('\n') + '\n')
}

/** Convert a program time into source time using the last render's regions. */
export function programToSource(regions: Region[], progMs: number): number | undefined {
  for (const r of regions) {
    const len = r.srcEndMs - r.srcStartMs
    if (progMs >= r.progStartMs && progMs <= r.progStartMs + len) return r.srcStartMs + (progMs - r.progStartMs)
  }
  return undefined
}

export async function addNote(
  projectsRoot: string,
  slug: string,
  input: { kind: string; progStartMs: number; progEndMs: number; text: string },
): Promise<Note> {
  const notes = await readNotes(projectsRoot, slug)
  const nextId = `n-${String(notes.length + 1).padStart(4, '0')}`
  // Map through the render the user was actually watching.
  const regions = await latestRegions(projectsRoot, slug)
  const srcStart = programToSource(regions, input.progStartMs)
  const srcEnd = programToSource(regions, input.progEndMs)
  if (srcStart === undefined || srcEnd === undefined) {
    throw new Error('that moment is not inside the last render — render first, then add the note')
  }
  const note = Note.parse({
    id: nextId,
    kind: input.kind,
    srcStartMs: Math.round(srcStart),
    srcEndMs: Math.round(Math.max(srcEnd, srcStart + 300)),
    text: input.text,
    createdAt: new Date().toISOString(),
    status: 'open',
    authoredProgramMs: Math.round(input.progStartMs),
  })
  await writeNotes(projectsRoot, slug, [...notes, note])
  return note
}

export async function deleteNote(projectsRoot: string, slug: string, id: string): Promise<void> {
  const notes = await readNotes(projectsRoot, slug)
  await writeNotes(projectsRoot, slug, notes.filter((n) => n.id !== id))
}

/** Regions from the most recent render sidecar, wherever it landed. */
async function latestRegions(projectsRoot: string, slug: string): Promise<Region[]> {
  const path = join(projectsRoot, slug, 'render', 'regions.json')
  if (!existsSync(path)) return []
  const data = JSON.parse(await readFile(path, 'utf8')) as { regions?: Region[] }
  return data.regions ?? []
}
