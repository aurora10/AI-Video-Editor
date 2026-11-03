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
  font: 'arial-bold',
  voicePolish: true,
  pace: 'normal',
  orientation: 'horizontal',
  background: 'none',
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
  font: [
    { value: 'arial-bold', label: 'Arial Bold (Cyrillic ok)', built: true, note: 'placeholder face — licensed, not shippable' },
    { value: 'inter', label: 'Inter', built: false, note: 'downloading + coverage check in progress' },
    { value: 'manrope', label: 'Manrope', built: false, note: 'not added yet' },
  ],
  voicePolish: [{ value: 'on', label: 'Voice polish', built: true }, { value: 'off', label: 'Raw audio', built: true }],
  pace: [
    { value: 'calm', label: 'Calm', built: false, note: 'pacing profiles not implemented yet' },
    { value: 'normal', label: 'Normal', built: true },
    { value: 'fast', label: 'Fast (all pauses cut)', built: true },
  ],
  orientation: [
    { value: 'horizontal', label: 'Horizontal 16:9', built: true },
    { value: 'vertical', label: 'Vertical 9:16', built: false, note: 'face-following crop not wired yet' },
  ],
  background: [
    { value: 'none', label: 'No background', built: true },
    { value: 'blur', label: 'Blurred background', built: false, note: 'needs subject matte' },
    { value: 'studio', label: 'Studio backdrop', built: false, note: 'needs subject matte' },
  ],
  graphics: [
    { value: 'none', label: 'No graphics', built: true },
    { value: 'broll', label: 'B-roll + graphics', built: false, note: 'graphics layer not built' },
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
): Promise<RenderSettings> {
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
  const onDisk = JSON.parse(await readFile(join(projectsRoot, slug, 'project.json'), 'utf8')) as Record<string, unknown>
  onDisk.settings = next
  await writeFile(join(projectsRoot, slug, 'project.json'), JSON.stringify(onDisk, null, 2) + '\n')
  return next
}
