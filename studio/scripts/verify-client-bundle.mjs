/**
 * Verify the built client bundle is *executable*, not merely served.
 *
 * The harness registers the bundle as a factory and only calls it at first
 * `require`, so a bundle that parses but throws on evaluation would look healthy
 * over HTTP and fail in the browser. This script replays the loader contract:
 * a fake `window.__ModuleLoader__` captures the factory, then the factory runs
 * with stubbed platform externals and its exports are checked.
 */
import { readFileSync } from 'node:fs'

const path = 'packages/client-pane/lib/client.js'
const source = readFileSync(path, 'utf8')

let captured = null
const globals = { __ModuleLoader__: { load: (entry) => { captured = entry } } }
globalThis.window = globals
globalThis.document = {
  head: { appendChild: () => {} },
  createElement: () => ({ dataset: {}, textContent: '' }),
}

// eslint-disable-next-line no-new-func
new Function('window', source)(globals)

if (captured === null) throw new Error('bundle did not call window.__ModuleLoader__.load')
if (captured.id !== 'dsh-video-client-pane') throw new Error(`unexpected entry id: ${captured.id}`)
if (typeof captured.factory !== 'function') throw new Error('entry has no factory')

/** Stand-ins for the platform modules the shell provides through the module table. */
const stubRequire = (specifier) => {
  if (specifier === 'react') {
    // Enough of React to let a real component run one render pass outside a browser.
    // Effects are not executed: this checks evaluation and the registration contract,
    // not lifecycle behaviour (the UI probe does that in a real browser).
    return {
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
      useLayoutEffect: () => {},
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useRef: (value) => ({ current: value }),
      useReducer: (_r, initial) => [initial, () => {}],
      createElement: (type, props, ...children) => ({ type, props, children }),
      version: 'stub',
      default: {},
    }
  }
  if (specifier === 'react/jsx-runtime') {
    return {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
      Fragment: Symbol.for('react.fragment'),
    }
  }
  throw new Error(`bundle required unexpected module: ${specifier}`)
}

// A real pane fetches on mount and may touch storage; give it inert stand-ins so the
// factory can be evaluated without a browser.
globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, value: { projects: [] } }) })
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

const exports = captured.factory(stubRequire)

if (typeof exports.apply !== 'function') throw new Error('client plugin does not export apply()')
if (!Array.isArray(exports.inject) || !exports.inject.includes('slots')) {
  throw new Error(`client plugin must inject the slot registry, got ${JSON.stringify(exports.inject)}`)
}

// Drive apply() against a fake slot service to prove the registration contract.
const registrations = []
let injectCalledWith = null
const fakeCtx = {
  effect: (fn) => { fn() },
  slots: {
    inject: (key, contribute) => { injectCalledWith = key; contribute() },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
}
exports.apply(fakeCtx)

if (injectCalledWith !== 'conversation.view') {
  throw new Error(`expected contribution into conversation.view, got ${injectCalledWith}`)
}
const [registration] = registrations
if (registrations.length !== 1) throw new Error(`expected exactly one registration, got ${registrations.length}`)
if (registration.options.id !== 'studio') throw new Error('view id must be "studio"')
if (typeof registration.options.label !== 'function' || registration.options.label() !== 'Studio') {
  throw new Error('view label must be a thunk returning "Studio"')
}
if (typeof registration.component !== 'function') throw new Error('view component is not a component')

// The injected factory must tolerate being handed a session id.
const injected = registration.options.inject('sess_123')
if (injected?.sessionId !== 'sess_123') throw new Error('inject() dropped the session id')

// Render the component once with the injected props to catch render-time throws.
const rendered = registration.component({ ...injected })
if (rendered === undefined || rendered === null) throw new Error('view rendered nothing')

console.log('✔ bundle evaluates; factory returns { apply, inject }')
console.log(`✔ apply() contributes 1 entry into "conversation.view" (id=studio, order=${registration.options.order})`)
console.log('✔ label thunk, session inject and first render all succeed')
