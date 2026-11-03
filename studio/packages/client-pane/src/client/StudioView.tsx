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
.dshstudio .auto { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: .75; }
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

const LABELS: Record<string, string> = {
  captions: 'Captions',
  captionStyle: 'Caption style',
  font: 'Font',
  voicePolish: 'Sound',
  pace: 'Pace',
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
      await api('render', { method: 'POST', body: JSON.stringify({ project: slug, from: '4:47', to: '5:47' }) })
      setDirty(false)
      await load(slug)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
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
          ? <video ref={videoRef} src={videoUrl} controls playsInline preload="metadata" />
          : <div className="status">No render yet — press Render to make one.</div>}
        {(dirty || state?.render?.stale === true) && state?.job?.status !== 'running' && (
          <div className="pending">Settings changed — press Render to see the new version.</div>
        )}
        {note !== null && <div className="note-banner">{note}</div>}
        <div className="bar">
          <button className={dirty || state?.render?.stale === true ? 'primary pulse' : 'primary'} onClick={() => void render()} disabled={busy || state?.job?.status === 'running' || slug === ''}>
            {state?.job?.status === 'running' ? 'Rendering…' : dirty || state?.render?.stale === true ? 'Render changes' : 'Re-render'}
          </button>
          <label className="auto"><input type="checkbox" checked={autoRender} onChange={(e) => setAutoRender(e.target.checked)} /> render on change</label>
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
