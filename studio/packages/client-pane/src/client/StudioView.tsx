/**
 * The Studio pane: the owner's controls, in the browser, where they belong.
 *
 * Design rule: every control maps to a renderer capability that exists. Options the engine
 * cannot honour yet are shown greyed with the reason, because a switch that silently does
 * nothing is worse than an honest "not built".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StudioViewProps } from './dsh.ts'

interface OptionSpec { value: string; label: string; built: boolean; note?: string }
type Settings = Record<string, string | boolean>
interface StatePayload {
  project: { slug: string; id: string; name: string }
  settings: Settings
  options: Record<string, OptionSpec[]>
  render: { url: string; file: string; mtimeMs: number; stale?: boolean } | null
  job: { status: 'running' | 'done' | 'failed'; log: string[]; error?: string; outputUrl?: string } | null
  adjustments?: string[]
  timeline?: { programMs: number; hasTimeline: boolean }
  window?: { fromMs: number; toMs: number; origin: string }
  candidates?: { id: string; startMs: number; endMs: number; durationSec: number; openingLine?: string; score?: number }[]
  aiCandidates?: { id: string; startMs: number; endMs: number; title?: string; openingLine?: string; rationale?: string }[]
  notes?: PaneNote[]
}

interface PaneNote {
  id: string
  kind: string
  srcStartMs: number
  srcEndMs: number
  text: string
  status: string
  authoredProgramMs?: number
}

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/video/api/${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await res.json()) as { ok: boolean; value?: T; error?: { message: string } }
  if (!body.ok) throw new Error(body.error?.message ?? 'request failed')
  return body.value as T
}

const STYLES = `
.dshstudio { display: grid; grid-template-columns: minmax(320px, 1fr) 360px; gap: 20px; padding: 20px; font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; color: #e6e6e6; height: 100%; box-sizing: border-box; }
.dshstudio * { box-sizing: border-box; }
.dshstudio h2 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
.dshstudio .sub { opacity: .55; font-size: 12px; margin-bottom: 14px; }
.dshstudio .stage { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dshstudio video { width: 100%; max-height: 62vh; background: #000; border-radius: 10px; }
.dshstudio .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dshstudio button { font: inherit; border-radius: 8px; border: 1px solid #3a3a3a; background: #1d1d1d; color: inherit; padding: 6px 11px; cursor: pointer; }
.dshstudio button:hover:not(:disabled) { background: #262626; }
.dshstudio button[aria-pressed="true"] { background: #2b6cb0; border-color: #2b6cb0; color: #fff; }
.dshstudio button:disabled { opacity: .4; cursor: not-allowed; }
.dshstudio button.primary { background: #1f7a3f; border-color: #1f7a3f; color: #fff; font-weight: 600; }
.dshstudio .panel { display: flex; flex-direction: column; gap: 14px; overflow-y: auto; padding-right: 4px; }
.dshstudio .group > .label { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .5; margin-bottom: 6px; }
.dshstudio .opts { display: flex; flex-wrap: wrap; gap: 6px; }
.dshstudio .note { font-size: 11px; opacity: .45; margin-top: 4px; }
.dshstudio .status { font-size: 12px; font-family: ui-monospace, monospace; background: #141414; border: 1px solid #2a2a2a; border-radius: 8px; padding: 8px 10px; max-height: 150px; overflow: auto; white-space: pre-wrap; }
.dshstudio .err { color: #ff8a8a; }
.dshstudio .pending { font-size: 13px; font-weight: 600; color: #ffd479; background: #332b12; border: 1px solid #6b5518; border-radius: 8px; padding: 8px 10px; }
.dshstudio .note-banner { font-size: 12px; color: #9ed0ff; background: #12222f; border: 1px solid #1d4460; border-radius: 8px; padding: 7px 10px; }
.dshstudio .primary.pulse { animation: dshstudio-pulse 1.6s ease-in-out infinite; }
@keyframes dshstudio-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(31,122,63,.7) } 50% { box-shadow: 0 0 0 6px rgba(31,122,63,0) } }
.dshstudio .opts.ai button { border-color: #4a3a12; background: #241d08; }
.dshstudio .auto { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: .75; }
.dshstudio .timeline-wrap { display: flex; flex-direction: column; gap: 8px; }
.dshstudio .timeline { position: relative; height: 30px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; cursor: crosshair; touch-action: none; }
.dshstudio .timeline .sel { position: absolute; top: 0; bottom: 0; background: rgba(43,108,176,.45); border-left: 1px solid #2b6cb0; border-right: 1px solid #2b6cb0; }
.dshstudio .timeline .head { position: absolute; top: -3px; bottom: -3px; width: 2px; background: #ffd479; pointer-events: none; }
.dshstudio .timeline .pin { position: absolute; top: 4px; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%; pointer-events: none; }
.dshstudio .timeline .pin.cut { background: #ff6b6b; }
.dshstudio .timeline .pin.hide-captions { background: #9ed0ff; }
.dshstudio .timeline .pin.text-card { background: #ffd479; }
.dshstudio .timeline .pin.free { background: #c792ea; }
.dshstudio .time { font: 12px ui-monospace, monospace; opacity: .7; }
.dshstudio .composer { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.dshstudio .time-input { flex: 0 0 110px; min-width: 90px; }
.dshstudio .window-group { background: #141414; border: 1px solid #262626; border-radius: 10px; padding: 10px; }
.dshstudio .notesel { font: inherit; padding: 6px 8px; border-radius: 8px; border: 1px solid #3a3a3a; background: #1d1d1d; color: inherit; max-width: 200px; }
.dshstudio .noteinput { flex: 1 1 220px; min-width: 160px; font: inherit; padding: 6px 9px; border-radius: 8px; border: 1px solid #3a3a3a; background: #1d1d1d; color: inherit; }
.dshstudio .notes { display: flex; flex-direction: column; gap: 3px; max-height: 130px; overflow-y: auto; }
.dshstudio .noterow { display: flex; align-items: center; gap: 8px; font-size: 12px; background: #171717; border: 1px solid #2a2a2a; border-radius: 6px; padding: 4px 8px; }
.dshstudio .noterow .t { font-family: ui-monospace, monospace; opacity: .7; }
.dshstudio .noterow .txt { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshstudio .noterow button { padding: 0 6px; background: transparent; border: none; color: #ff8a8a; }
.dshstudio .kindtag { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; padding: 1px 5px; border-radius: 4px; background: #262626; }
.dshstudio .kindtag.cut { background: #4a1f1f; color: #ffb3b3; }
.dshstudio .kindtag.hide-captions { background: #16303f; color: #9ed0ff; }
.dshstudio .kindtag.text-card { background: #3d3315; color: #ffd479; }
.dshstudio .kindtag.free { background: #2c2140; color: #c792ea; }
.dshstudio .ok { color: #7ddc9a; }
`

let injected = false
const injectStyles = (): void => {
  if (injected || typeof document === 'undefined') return
  injected = true
  const el = document.createElement('style')
  el.dataset.plugin = 'dsh-video-client-pane'
  el.textContent = STYLES
  document.head.appendChild(el)
}

const NOTE_LABEL = {
  cut: 'Cut',
  'hide-captions': 'No captions',
  'text-card': 'Text card',
  'image-inset': 'Image',
  free: 'Instruction',
} as const

const fmt = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 100) / 10)
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

const LABELS: Record<string, string> = {
  captions: 'Captions',
  captionStyle: 'Caption style',
  font: 'Font',
  voicePolish: 'Sound',
  pace: 'Pace',
  mumbles: 'Mumbles',
  orientation: 'Format',
  background: 'Background',
  graphics: 'Graphics and B-roll',
}

export function StudioView(props: StudioViewProps) {
  injectStyles()
  const [slug, setSlug] = useState<string>('')
  const [projects, setProjects] = useState<string[]>([])
  const [state, setState] = useState<StatePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [autoRender, setAutoRender] = useState(true)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null)
  const [noteKind, setNoteKind] = useState('cut')
  const [noteText, setNoteText] = useState('')
  const [assets, setAssets] = useState<{ path: string; name: string; kind: string }[]>([])
  const [chosenAsset, setChosenAsset] = useState('')
  const [dragging, setDragging] = useState<number | null>(null)
  const [askSent, setAskSent] = useState<string | null>(null)
  const [winFrom, setWinFrom] = useState('')
  const [winTo, setWinTo] = useState('')
  const [awaitingAgent, setAwaitingAgent] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const load = useCallback(async (which: string) => {
    try {
      const value = await api<StatePayload>(`state?project=${encodeURIComponent(which)}`)
      setState(value)
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])

  // discover projects once
  useEffect(() => {
    void (async () => {
      try {
        const { projects: list } = await api<{ projects: { slug: string }[] }>('projects')
        const slugs = list.map((p) => p.slug)
        setProjects(slugs)
        const remembered = typeof localStorage === 'undefined' ? '' : localStorage.getItem('dshstudio.project') ?? ''
        const pick = slugs.includes(remembered) ? remembered : slugs[0] ?? ''
        setSlug(pick)
        if (pick !== '') await load(pick)
      } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    })()
  }, [load])

  // available images/videos for 'show this next to me'
  useEffect(() => {
    if (slug === '') return
    void (async () => {
      try {
        const { assets: list } = await api<{ assets: { path: string; name: string; kind: string }[] }>(`assets?project=${encodeURIComponent(slug)}`)
        setAssets(list.filter((a) => a.kind === 'image' || a.kind === 'video'))
        setChosenAsset((prev) => (prev === '' ? list.find((a) => a.kind === 'image')?.path ?? '' : prev))
      } catch { setAssets([]) }
    })()
  }, [slug])

  // poll after asking the agent: it writes edit/candidates.ai.json in its own turn, which the pane
  // cannot otherwise notice (there is no push channel for it yet)
  useEffect(() => {
    if (!awaitingAgent || slug === '') return
    const timer = setInterval(() => { void load(slug) }, 5000)
    const stop = setTimeout(() => setAwaitingAgent(false), 180_000)
    return () => { clearInterval(timer); clearTimeout(stop) }
  }, [awaitingAgent, slug, load])

  // poll while a render runs
  useEffect(() => {
    if (state?.job?.status !== 'running' || slug === '') return
    const timer = setInterval(() => { void load(slug) }, 2000)
    return () => clearInterval(timer)
  }, [state?.job?.status, slug, load])

  const change = async (key: string, value: string | boolean) => {
    if (slug === '') return
    setBusy(true)
    try {
      const result = await api<{ settings: Settings; adjustments?: string[] }>('settings', {
        method: 'POST',
        body: JSON.stringify({ project: slug, patch: { [key]: value } }),
      })
      setNote(result.adjustments?.[0] ?? null)
      setDirty(true)
      await load(slug)
      // A settings change only becomes visible in a new render. Leaving that implicit made the
      // controls look broken, so by default the change re-renders immediately.
      if (autoRender) await render()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const render = async () => {
    if (slug === '') return
    setBusy(true)
    try {
      await api('render', { method: 'POST', body: JSON.stringify({ project: slug }) })
      setDirty(false)
      await load(slug)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const programMs = state?.timeline?.programMs ?? 0
  const pct = (ms: number) => (programMs === 0 ? 0 : Math.max(0, Math.min(100, (ms / programMs) * 100)))

  const msFromEvent = (e: React.PointerEvent<HTMLDivElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    return Math.round(ratio * programMs)
  }

  const seek = (ms: number) => {
    setPlayheadMs(ms)
    const v = videoRef.current
    if (v !== null) v.currentTime = ms / 1000
  }

  const addNote = async () => {
    if (slug === '' || programMs === 0) return
    const from = selection?.from ?? playheadMs
    const to = selection?.to ?? Math.min(programMs, playheadMs + 2000)
    setBusy(true)
    try {
      await api('notes', {
        method: 'POST',
        body: JSON.stringify({
          project: slug, kind: noteKind, progStartMs: from, progEndMs: to, text: noteText,
          ...(noteKind === 'image-inset' && chosenAsset !== '' ? { asset: chosenAsset } : {}),
        }),
      })
      setNoteText('')
      setSelection(null)
      setDirty(true)
      await load(slug)
      if (autoRender) await render()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const askAgent = async (request: string) => {
    if (slug === '' || props.sessionId === undefined) return
    setBusy(true)
    setAskSent(request)
    try {
      await api('ask', {
        method: 'POST',
        body: JSON.stringify({ project: slug, sessionId: String(props.sessionId), request }),
      })
      setAwaitingAgent(true)
      setNote(request === 'suggest-windows'
        ? 'Asked the agent to propose windows on meaning — they will appear below when it writes them.'
        : 'Sent to the agent — it will work in the chat and re-render when done.')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const setWindow = async (window: { fromMs?: number; toMs?: number; candidateIndex?: number; aiCandidateIndex?: number }) => {
    if (slug === '') return
    setBusy(true)
    try {
      await api('window', { method: 'POST', body: JSON.stringify({ project: slug, ...window }) })
      setDirty(true)
      await load(slug)
      if (autoRender) await render()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const removeNote = async (id: string) => {
    if (slug === '') return
    try {
      await api('notes/delete', { method: 'POST', body: JSON.stringify({ project: slug, id }) })
      setDirty(true)
      await load(slug)
      if (autoRender) await render()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const videoUrl = useMemo(() => {
    if (state?.job?.status === 'done' && state.job.outputUrl !== undefined) return `${state.job.outputUrl}?t=${Date.now()}`
    return state?.render?.url ?? null
  }, [state])

  if (error !== null && state === null) {
    return <div className="dshstudio"><div className="err">Studio: {error}</div></div>
  }

  return (
    <div className="dshstudio">
      <div className="stage">
        <div>
          <h2>{state?.project.name ?? 'Studio'}</h2>
          <div className="sub">session {String(props.sessionId ?? 'unbound')}</div>
        </div>
        {videoUrl !== null
          ? <video ref={videoRef} src={videoUrl} controls playsInline preload="metadata"
            onTimeUpdate={(e) => setPlayheadMs(Math.round(e.currentTarget.currentTime * 1000))} />
          : <div className="status">No render yet — press Render to make one.</div>}
        {(dirty || state?.render?.stale === true) && state?.job?.status !== 'running' && (
          <div className="pending">Settings changed — press Render to see the new version.</div>
        )}
        {note !== null && <div className="note-banner">{note}</div>}
        <div className="group window-group">
          <div className="label">Window — which part of the footage</div>
          <div className="opts">
            <input className="noteinput time-input" placeholder="from 4:47" value={winFrom}
              onChange={(e) => setWinFrom(e.target.value)} />
            <input className="noteinput time-input" placeholder="to 5:47" value={winTo}
              onChange={(e) => setWinTo(e.target.value)} />
            <button className="primary" disabled={busy || slug === ''}
              onClick={() => {
                const p = (v: string) => { const m = /^(\d+):(\d{1,2})$/.exec(v.trim()); return m === null ? NaN : (Number(m[1]) * 60 + Number(m[2])) * 1000 }
                const fromMs = p(winFrom), toMs = p(winTo)
                if (Number.isNaN(fromMs) || Number.isNaN(toMs)) { setError('use m:ss, e.g. 6:50'); return }
                void setWindow({ fromMs, toMs })
              }}>Use this window</button>
          </div>
          {state?.window !== undefined && (
            <div className="note">
              editing source {fmt(state.window.fromMs)}–{fmt(state.window.toMs)} ({((state.window.toMs - state.window.fromMs) / 1000).toFixed(0)}s, {state.window.origin})
            </div>
          )}
          <div className="opts">
            <button onClick={() => void askAgent('suggest-windows')} disabled={busy || slug === ''}
              title="Ask the agent to choose windows by meaning rather than speech density">
              {awaitingAgent ? 'Asking the agent…' : 'Suggest windows with AI'}
            </button>
          </div>
          {(state?.aiCandidates ?? []).length > 0 && (
            <div className="opts ai">
              {(state?.aiCandidates ?? []).map((c, i) => (
                <button key={c.id} onClick={() => void setWindow({ aiCandidateIndex: i })} disabled={busy}
                  title={c.rationale ?? ''}>
                  ★ {c.title ?? `${fmt(c.startMs)}–${fmt(c.endMs)}`}
                </button>
              ))}
            </div>
          )}
          {(state?.candidates ?? []).length > 0 && (
            <div className="opts">
              {(state?.candidates ?? []).map((c, i) => (
                <button key={c.id} onClick={() => void setWindow({ candidateIndex: i })} disabled={busy}
                  title={`from speech density: ${c.openingLine ?? ''}`}>
                  {fmt(c.startMs)}–{fmt(c.endMs)} · {c.durationSec}s
                </button>
              ))}
            </div>
          )}
        </div>
        {programMs > 0 && (
          <div className="timeline-wrap">
            <div
              className="timeline"
              onPointerDown={(e) => {
                const ms = msFromEvent(e)
                seek(ms)
                setSelection({ from: ms, to: ms })
                setDragging(ms)
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (dragging === null) return
                const ms = msFromEvent(e)
                setSelection({ from: Math.min(dragging, ms), to: Math.max(dragging, ms) })
              }}
              onPointerUp={() => setDragging(null)}
            >
              {selection !== null && selection.to > selection.from && (
                <div className="sel" style={{ left: `${pct(selection.from)}%`, width: `${pct(selection.to) - pct(selection.from)}%` }} />
              )}
              {(state?.notes ?? []).map((n) => (
                <div key={n.id} className={`pin ${n.kind}`} style={{ left: `${pct(n.authoredProgramMs ?? 0)}%` }} title={`${n.kind}: ${n.text || '(no text)'}`} />
              ))}
              <div className="head" style={{ left: `${pct(playheadMs)}%` }} />
            </div>
            <div className="time">
              {fmt(playheadMs)} / {fmt(programMs)}
              {selection !== null && selection.to > selection.from + 50 && ` · selected ${fmt(selection.from)}–${fmt(selection.to)}`}
            </div>
            <div className="composer">
              {(['cut', 'hide-captions', 'text-card', 'image-inset', 'free'] as const).map((k) => (
                <button key={k} aria-pressed={noteKind === k} onClick={() => setNoteKind(k)}>{NOTE_LABEL[k]}</button>
              ))}
              {noteKind === 'image-inset' && (
                assets.length === 0
                  ? <span className="note">no images in projects/…/assets/ yet — drop one there</span>
                  : (
                    <select className="notesel" value={chosenAsset} onChange={(e) => setChosenAsset(e.target.value)}>
                      {assets.map((a) => <option key={a.path} value={a.path}>{a.name}</option>)}
                    </select>
                  )
              )}
              <input
                className="noteinput"
                placeholder={noteKind === 'cut' || noteKind === 'hide-captions' ? 'why? (optional)' : noteKind === 'image-inset' ? 'caption for the image (optional)' : 'what should appear / what to change'}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <button className="primary" disabled={busy || slug === ''} onClick={() => void addNote()}>
                {selection !== null && selection.to > selection.from + 50 ? 'Add note for selection' : 'Add note at playhead'}
              </button>
            </div>
            {(state?.notes ?? []).length > 0 && (
              <div className="notes">
                {(state?.notes ?? []).map((n) => (
                  <div key={n.id} className="noterow">
                    <span className={`kindtag ${n.kind}`}>{NOTE_LABEL[n.kind as keyof typeof NOTE_LABEL] ?? n.kind}</span>
                    <span className="t">{fmt(n.authoredProgramMs ?? 0)}</span>
                    <span className="txt">{n.text || '—'}</span>
                    <button onClick={() => void removeNote(n.id)} title="delete">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="bar">
          <button className={dirty || state?.render?.stale === true ? 'primary pulse' : 'primary'} onClick={() => void render()} disabled={busy || state?.job?.status === 'running' || slug === ''}>
            {state?.job?.status === 'running' ? 'Rendering…' : dirty || state?.render?.stale === true ? 'Render changes' : 'Re-render'}
          </button>
          <label className="auto"><input type="checkbox" checked={autoRender} onChange={(e) => setAutoRender(e.target.checked)} /> render on change</label>
          <button onClick={() => void askAgent('plan-cuts')} disabled={busy || slug === ''} title="Ask the agent to judge every pause and write edit/cut-plan.json">
            Plan cuts with AI
          </button>
          <button onClick={() => void askAgent('review-look')} disabled={busy || slug === ''} title="Ask the agent to watch the current render and propose improvements">
            Ask for a review
          </button>
          <button onClick={() => { if (videoRef.current !== null) { videoRef.current.currentTime = 0; void videoRef.current.play() } }} disabled={videoUrl === null}>Replay</button>
          {state?.render !== null && state?.render !== undefined && <span className="sub" style={{ margin: 0 }}>latest: {state.render.file}</span>}
        </div>
        {state?.job !== null && state?.job !== undefined && (
          <div className={`status ${state.job.status === 'failed' ? 'err' : ''}`}>
            {state.job.status === 'failed' ? `failed: ${state.job.error ?? ''}` : state.job.log.slice(-6).join('\n')}
          </div>
        )}
        {error !== null && <div className="status err">{error}</div>}
      </div>

      <div className="panel">
        {projects.length > 1 && (
          <div className="group">
            <div className="label">Project</div>
            <div className="opts">
              {projects.map((p) => (
                <button key={p} aria-pressed={p === slug} onClick={() => { setSlug(p); if (typeof localStorage !== 'undefined') localStorage.setItem('dshstudio.project', p); void load(p) }}>{p}</button>
              ))}
            </div>
          </div>
        )}
        {state !== null && Object.entries(state.options).map(([key, options]) => (
          <div className="group" key={key}>
            <div className="label">{LABELS[key] ?? key}</div>
            <div className="opts">
              {options.map((option) => {
                const current = typeof state.settings[key] === 'boolean'
                  ? (state.settings[key] === true ? 'on' : 'off')
                  : String(state.settings[key])
                return (
                  <button
                    key={option.value}
                    aria-pressed={current === option.value}
                    disabled={!option.built || busy}
                    title={option.note ?? ''}
                    onClick={() => void change(key, typeof state.settings[key] === 'boolean' ? option.value === 'on' : option.value)}
                  >
                    {option.label}{option.built ? '' : ' — not built yet'}
                  </button>
                )
              })}
            </div>
            {options.some((o) => !o.built) && (
              <div className="note">{options.filter((o) => !o.built).map((o) => `${o.label}: ${o.note ?? 'unbuilt'}`).join(' · ')}</div>
            )}
          </div>
        ))}
        <div className="note">
          Changes apply on the next render. Timeline scrubbing, point-and-instruct notes and drag
          editing arrive with the overlay editor.
        </div>
      </div>
    </div>
  )
}
