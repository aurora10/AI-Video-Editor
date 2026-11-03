/**
 * Project settings: the values the pane edits and the renderer obeys.
 *
 * Stored in `project.json` under `settings`, so a project is self-describing and a render can
 * be reproduced from the project folder alone. Every field here maps to a renderer capability
 * that exists; a setting with no implementation is listed in `UNBUILT` instead of being
 * offered as a switch that would do nothing.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FONT_LIBRARY } from '@dsh-video/core'

export interface RenderSettings {
  /** Captions shown at all. */
  captions: boolean
  /** 'word' = one word at a time, 'phrase' = phrase with the active word accented, 'none' = plain block. */
  captionStyle: 'word' | 'phrase' | 'plain'
  /** Font family key from the bundled library. */
  font: string
  /** Voice polish chain on/off. */
  voicePolish: boolean
  /** Pacing profile — how much silence is retained between phrases. */
  pace: 'calm' | 'normal' | 'fast'
  /** Remove mumbles: sound with no words, hesitations, isolated markers, false starts. */
  mumbles: 'cut' | 'keep'
  /** Delivery orientation. */
  orientation: 'horizontal' | 'vertical'
  /** Background treatment behind the speaker. */
  background: 'none' | 'blur' | 'studio'
  /** Graphics/B-roll layer. */
  graphics: 'none' | 'broll'
}

export const DEFAULT_SETTINGS: RenderSettings = {
  captions: true,
  captionStyle: 'word',
  font: 'inter',
  voicePolish: true,
  pace: 'normal',
  mumbles: 'cut',
  orientation: 'vertical',
  background: 'blur',
  graphics: 'none',
}

/** Options a control may offer, with whether the engine can honour them today. */
export interface OptionSpec {
  value: string
  label: string
  built: boolean
  note?: string
}

export const OPTIONS: Record<keyof RenderSettings, OptionSpec[]> = {
  captions: [{ value: 'on', label: 'Captions', built: true }, { value: 'off', label: 'No captions', built: true }],
  captionStyle: [
    { value: 'word', label: 'One word at a time', built: true },
    { value: 'phrase', label: 'Phrase, active word highlighted', built: true },
    { value: 'plain', label: 'Plain block', built: true },
  ],
  // One entry per bundled face that passed the Cyrillic coverage gate.
  font: FONT_LIBRARY.map((f) => ({ value: f.key, label: f.label, built: true })),
  voicePolish: [{ value: 'on', label: 'Voice polish', built: true }, { value: 'off', label: 'Raw audio', built: true }],
  pace: [
    { value: 'calm', label: 'Calm (keeps a breath)', built: true },
    { value: 'normal', label: 'Normal', built: true },
    { value: 'fast', label: 'Fast (all pauses cut)', built: true },
  ],
  mumbles: [
    { value: 'cut', label: 'Remove mumbles', built: true, note: 'sound with no words, hesitations, isolated "ну/вот/значит", false starts' },
    { value: 'keep', label: 'Keep everything', built: true },
  ],
  orientation: [
    { value: 'horizontal', label: 'Horizontal 16:9', built: true },
    { value: 'vertical', label: 'Vertical 9:16', built: true, note: 'crop follows the median face position' },
  ],
  background: [
    { value: 'none', label: 'Crop to fill', built: true, note: 'vertical keeps only ~32% of a 16:9 frame' },
    { value: 'blur', label: 'Blurred background', built: true, note: 'vertical only: whole frame fitted over a blurred copy of itself' },
    { value: 'studio', label: 'Studio look', built: true, note: 'blurred fill plus a vignette and a quieter grade' },
  ],
  graphics: [
    { value: 'none', label: 'No graphics', built: true },
    { value: 'broll', label: 'Graphics layer', built: true, note: 'composites everything in edit/graphics.json (text cards, insets, B-roll video)' },
  ],
}

export interface ProjectRecordWithSettings {
  slug: string
  id: string
  settings?: Partial<RenderSettings>
  [key: string]: unknown
}

export async function readProject(projectsRoot: string, slug: string): Promise<ProjectRecordWithSettings> {
  const raw = await readFile(join(projectsRoot, slug, 'project.json'), 'utf8')
  const record = JSON.parse(raw) as ProjectRecordWithSettings
  record.slug = slug
  record.settings = { ...DEFAULT_SETTINGS, ...(record.settings ?? {}) }
  return record
}

/** Merge a patch into the stored settings, rejecting values the engine cannot honour. */
export async function writeProjectSettings(
  projectsRoot: string,
  slug: string,
  patch: Partial<RenderSettings>,
): Promise<{ settings: RenderSettings; adjustments: string[] }> {
  const record = await readProject(projectsRoot, slug)
  const next: RenderSettings = { ...DEFAULT_SETTINGS, ...record.settings }
  for (const [key, value] of Object.entries(patch) as [keyof RenderSettings, never][]) {
    const spec = OPTIONS[key]
    if (spec === undefined) throw new Error(`unknown setting "${key}"`)
    const allowed = spec.find((o) => o.value === String(value))
    if (allowed === undefined) throw new Error(`"${String(value)}" is not a valid value for ${key}`)
    if (!allowed.built) throw new Error(`${key} = "${allowed.value}" is not implemented yet (${allowed.note ?? 'unbuilt'})`)
    next[key] = value
  }
  // A background treatment needs a frame that does not fill the canvas. Horizontal delivery fills
  // it, so the treatment is meaningless there. Rejecting the click made the control look broken;
  // coercing silently would be a switch that lies. So: coerce, and report the adjustment.
  const adjustments: string[] = []
  if (next.orientation === 'horizontal' && next.background !== 'none') {
    adjustments.push(`background reset to None — a ${next.background} background only applies to vertical delivery`)
    next.background = 'none'
  }
  const onDisk = JSON.parse(await readFile(join(projectsRoot, slug, 'project.json'), 'utf8')) as Record<string, unknown>
  onDisk.settings = next
  await writeFile(join(projectsRoot, slug, 'project.json'), JSON.stringify(onDisk, null, 2) + '\n')
  return { settings: next, adjustments }
}
