/**
 * Bundle the client half to the harness artifact contract.
 *
 * The contract, reproduced from `packages/client/tsdown.client.ts` in the DSH
 * checkout (`clientConfig`, lines ~437–565):
 *   - CJS closure factory: `window.__ModuleLoader__.load({ id, factory: (require) => { … } })`
 *   - `var module = { exports: {} }; var exports = module.exports;` as the intro
 *   - `return module.exports; } });` as the footer
 *   - React and the shared platform modules stay external; everything else inlines
 *   - the browser half lands at `lib/client.js` next to the node half
 *
 * Anything the loader's module table cannot answer must be bundled — a stray
 * `require()` of an unbundled package is a guaranteed runtime throw.
 */
import * as esbuild from 'esbuild'
import { readFileSync, statSync } from 'node:fs'

const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

const id = JSON.parse(readFileSync('packages/client-pane/package.json', 'utf8')).name

// --- browser half ----------------------------------------------------------
await esbuild.build({
  entryPoints: ['packages/client-pane/src/client/index.ts'],
  outfile: 'packages/client-pane/lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  sourcemap: true,
  logLevel: 'warning',
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: `return module.exports; } });`,
  },
})

// --- node half -------------------------------------------------------------
await esbuild.build({
  entryPoints: ['packages/client-pane/src/index.ts'],
  outfile: 'packages/client-pane/lib/index.js',
  bundle: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
})

// --- contract assertions (fail the build, not the boot) --------------------
const clientPath = 'packages/client-pane/lib/client.js'
const bundle = readFileSync(clientPath, 'utf8')
const required = [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  'return module.exports; } });',
]
for (const needle of required) {
  if (!bundle.startsWith(needle) && !bundle.includes(needle)) {
    throw new Error(`client bundle violates the artifact contract: missing ${JSON.stringify(needle.slice(0, 60))}`)
  }
}
// The sourcemap comment trails the artifact, so the footer is the last *code*.
const code = bundle.replace(/\/\/# sourceMappingURL=.*\s*$/, '').trimEnd()
if (!code.endsWith('return module.exports; } });')) {
  throw new Error('client bundle must END with the factory footer (before the sourcemap comment)')
}
// No bare require() of anything outside the platform set may survive.
const requires = [...bundle.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1])
const offenders = [...new Set(requires.filter((r) => !PLATFORM_MODULES.includes(r)))]
if (offenders.length > 0) {
  throw new Error(`client bundle requires non-external modules: ${offenders.join(', ')}`)
}

const kb = (p) => (statSync(p).size / 1024).toFixed(1)
console.log(`✔ ${clientPath} — ${kb(clientPath)} KB, externals: ${[...new Set(requires)].join(', ') || 'none'}`)
console.log(`✔ packages/client-pane/lib/index.js — ${kb('packages/client-pane/lib/index.js')} KB`)
console.log('✔ artifact contract satisfied (banner, intro, footer, externals)')
