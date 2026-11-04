/**
 * The pane → agent bridge.
 *
 * Until now the pane could only change settings; anything requiring judgement (plan the cuts,
 * "make this bit slower", "cut the boring part") had nowhere to go. This module submits a request
 * into the live agent that owns the session the pane belongs to, as an ordinary user message, so
 * the agent uses the same tools and the same approval policy as if the owner had typed it.
 *
 * The message body is deliberately structured: the agent needs to know WHICH project, WHERE its
 * files are, and WHAT the current settings are, or it will spend a turn rediscovering them.
 */
import type { RenderSettings } from './settings.js'
import type { TimelineInfo } from './notes.js'

/**
 * Minimal structural view of the agent registry and agent.
 *
 * Out-of-tree plugins cannot import the harness's private packages, so the shape is described here
 * and validated by use. `followup` takes a `UserMessage`, which is a plain frozen object
 * ({ id, role, content, source }) — the harness's own `createUserMessage` adds nothing this does
 * not.
 */
export interface AgentLike {
  readonly sessionId: string
  followup(message: PaneMessage): void
}
export interface PaneMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: { type: 'text'; text: string }[]
  readonly source: { kind: 'plugin'; plugin: string }
}
export interface AgentsLike { get(sessionId: string): AgentLike | undefined }

/**
 * What the agent must do for a window suggestion, spelled out.
 *
 * The heuristic candidate list is ranked by speech density and sentence cleanliness. That is not
 * the same as judging whether 45 seconds stands on its own as a short — which needs the meaning of
 * the words. This asks for exactly that, and for a machine-readable file the pane can render.
 */
const WINDOW_REQUEST = [
  'Task: propose 3–5 candidate windows that would each work as a STANDALONE short (35–60 s).',
  'Judge on meaning, not on density: a complete argument or story beat, a strong first line that',
  'works without context, and an ending that lands. Reject windows that open mid-sentence or need',
  'the preceding minute to make sense. Windows may overlap; say why you would pick each one.',
  '',
  'Write the result to edit/candidates.ai.json:',
  '{"schemaVersion":1,"generatedAt":"<iso>","candidates":[',
  ' {"id":"ai-1","startMs":<int>,"endMs":<int>,"title":"<6 words>","openingLine":"<first 12 words>",',
  '  "rationale":"<one sentence: why this holds attention alone>"}]}',
  '',
  'Boundaries must sit on sentence boundaries from analysis/transcript.*.refined.json.',
  'Then state which one you would pick and why.',
].join('\n')

export interface AskContext {
  projectSlug: string
  projectRoot: string
  request: string
  settings: RenderSettings
  timeline: TimelineInfo
  openNotes: number
}

/** Render the message the agent receives. */
export function renderAsk(ctx: AskContext): string {
  const s = ctx.settings
  return [
    `<video_pane project="${ctx.projectSlug}" request="${ctx.request}">`,
    `The owner used the Studio pane. Project files are under ${ctx.projectRoot}:`,
    `  edit/cut-plan.json   per-pause cut decisions (create or replace)`,
    `  edit/graphics.json   graphics track`,
    `  edit/notes.jsonl     timeline notes`,
    `  analysis/            transcript, refined transcript, silence map, face track`,
    `  render/regions.json  source↔program map of the last render`,
    `Current settings: format ${s.orientation}, background ${s.background}, captions ${s.captions ? s.captionStyle : 'off'}, font ${s.font}, pace ${s.pace}, mumbles ${s.mumbles}, graphics ${s.graphics}.`,
    `Timeline: the last render is ${(ctx.timeline.programMs / 1000).toFixed(1)}s of program starting at source ${ctx.timeline.windowFromMs}ms. ${ctx.openNotes} note(s) stored.`,
    `</video_pane>`,
    '',
    ...(ctx.request === 'suggest-windows' ? [WINDOW_REQUEST] : []),
    "Carry out the request above. Re-render when done so the pane shows the result, and report",
    'in one or two sentences what you changed and what you decided against.',
  ].join('\n')
}

/**
 * Submit the request to the live agent.
 * @returns a short status for the pane.
 */
export function askAgent(agents: AgentsLike, sessionId: string, ctx: AskContext): { ok: boolean; reason?: string } {
  const agent = agents.get(sessionId)
  if (agent === undefined) {
    return { ok: false, reason: `no live agent for session ${sessionId} — open a conversation first` }
  }
  agent.followup({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: renderAsk(ctx) }],
    source: { kind: 'plugin', plugin: 'dsh-video' },
  })
  return { ok: true }
}
