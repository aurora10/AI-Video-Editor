/**
 * Studio view — spike S2 placeholder.
 *
 * Its only job right now is to prove that an out-of-tree client bundle can take
 * a seat in `conversation.view`. The real pane (viewer, timeline, notes rail)
 * lands in phase F, after the two gates are green.
 */
import { useEffect, useState } from 'react'
import type { StudioViewProps } from './dsh.ts'

const STYLES = `
.dsh-studio-spike {
  display: flex; flex-direction: column; gap: 12px;
  padding: 24px; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
}
.dsh-studio-spike h2 { font-size: 16px; font-weight: 600; margin: 0; }
.dsh-studio-spike dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
.dsh-studio-spike dt { opacity: 0.6; }
.dsh-studio-spike dd { margin: 0; font-family: ui-monospace, monospace; }
.dsh-studio-spike .ok { color: #1a7f37; font-weight: 600; }
`

let stylesInjected = false
function injectStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  const el = document.createElement('style')
  el.dataset.plugin = 'dsh-video-client-pane'
  el.textContent = STYLES
  document.head.appendChild(el)
}

export function StudioView(props: StudioViewProps) {
  injectStyles()
  const [ticks, setTicks] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTicks((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="dsh-studio-spike">
      <h2>
        Studio pane <span className="ok">online</span>
      </h2>
      <dl>
        <dt>bundle</dt>
        <dd>dsh-video-client-pane</dd>
        <dt>session</dt>
        <dd>{String(props.sessionId ?? 'unbound')}</dd>
        <dt>react</dt>
        <dd>{String((globalThis as { React?: { version?: string } }).React?.version ?? 'from module table')}</dd>
        <dt>ticking</dt>
        <dd>{ticks}s — proves the component is mounted and re-rendering</dd>
      </dl>
      <p style={{ opacity: 0.7, margin: 0 }}>
        Spike S2. The viewer, timeline and notes rail arrive after gates S2/S3 are green — see{' '}
        <code>docs/build-plan.md</code>.
      </p>
    </div>
  )
}
