# studio — the product workspace

`dsh studio` is an out-of-tree bundle for DeepSeek Harness. Nothing here patches the harness checkout.

## Layout

```
packages/core/          EDL schema · resolver · diff · layout · digest (pure; host + browser)
packages/client-pane/   the Studio pane — one client bundle + a thin node half
packages/bundle/        dsh.bundle manifest + cordis.patch.yml (the install surface)
scripts/                doctor · build-client · verify-client-bundle
fixtures/               project fixtures, pinned fonts, incoming footage (gitignored)
.dsh-home/              workspace-local DSH_HOME for the spike profile (gitignored)
```

## Commands

```sh
cd studio
pnpm install
pnpm -s typecheck                 # tsc -b
pnpm -s test                      # vitest
pnpm -s doctor                    # what this machine can/cannot do (exits non-zero on hard misses)

node scripts/build-client.mjs           # bundle the pane + assert the DSH artifact contract
node scripts/verify-client-bundle.mjs   # evaluate the bundle, run apply(), render once
```

## Running the Studio pane in the harness (spike S2, verified)

The harness resolves in-box bundles from its own installation, so we point `DSH_HOME` at a
workspace-local directory instead of touching `~/.dsh`:

```sh
export DSH_HOME="$PWD/.dsh-home"          # from studio/

# one-time: create the profile and link our packages
pnpm dsh plugin --profile studio add ./packages/bundle
#   then add the in-box web bundle to dsh.profile.bundles (it needs no install):
#   ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-studio"]
#   and add the plugin package itself, because a *linked* bundle does not
#   bring its nested deps into the profile's resolution root:
#   "dsh-video-client-pane": "link:<abs>/packages/client-pane"

pnpm dsh --profile studio --dump-config | grep -A4 'dsh-studio'   # verify composition
pnpm dsh --profile studio --no-open                               # boot (webserver port pinned to 3099)
```

Then open <http://127.0.0.1:3099>, start a chat session, and look for the **Studio** tab.

`pnpm dsh` is `pnpm --dir ~/Desktop/deepseek-harness dsh …`. Note `dsh web` is a hardcoded alias for
`--profile web`; custom profiles boot as `dsh --profile <name>` with the app's own flags after it.

## What the spike established

| Finding | Consequence |
|---|---|
| An out-of-tree package can take a seat in `conversation.view` | The pane is native, not an iframe (fallback (d) not needed) |
| The artifact contract is reproducible with plain esbuild: `window.__ModuleLoader__.load({id, factory: (require) => {…}})`, CJS, `var module = {exports:{}}` intro, `return module.exports; } });` footer | DSH's tsdown preset is not required; ~40 lines of build script |
| The footer sits **before** the `//# sourceMappingURL` comment | A naive "ends with footer" gate fails — strip the map comment first |
| `workspace:*` cannot cross the workspace boundary | Bundle deps use `file:` / `link:` |
| A linked bundle does not carry its nested deps | The plugin package must be a profile dependency too |
| A fresh profile initialises with `dsh-base` only; `dsh plugin add @deepseek-ai/dsh-web-app` 404s against npm | Add the in-box bundle to `dsh.profile.bundles` by hand |
| `@deepseek-ai/*` packages are workspace-private | Out-of-tree client plugins need their own structural types (`src/client/dsh.ts`) |

## UI probe (how "is it on screen?" becomes a measurement)

```sh
node scripts/ui-probe.mjs --wait 9000 \
  --steps '[{"click":"Greeting to the AI assistant","wait":6000},{"click":"Studio","wait":3500}]' \
  --eval 'window.__DSH_STUDIO_DIAG__'
```

Headless Chrome + CDP via `puppeteer-core`, reporting console errors, uncaught exceptions, failed
requests, exact-text node counts, `[role=tab]` lists and any `--eval` expression. Two hard-won details:

- Chrome **must** run with `--no-sandbox --disable-crash-reporter --disable-breakpad` and an isolated
  `--user-data-dir` inside the workspace — otherwise it dies silently (its own sandbox cannot nest
  inside the harness sandbox, and it cannot write crashpad dumps outside the workspace).
- `conversation.view` paints **only inside an open conversation**. On the session-list screen there is
  no tab strip at all, so "no Studio tab" usually means "no session open", not "plugin broken".

## Verification output (gate S2)

```
43/43 plugin bundles fetched, incl. dsh-video-client-pane/client.js?rev=a69b854bde50
window.__DSH_STUDIO_DIAG__ → { applyCalled:true, injectCallbackRan:true, registered:true, error:null }
[role=tab] with a conversation open → ["Chat", "Trajectory", "Studio"]
click Studio → paneMounted:1 · "Studio pane online … ticking 3s"
```
