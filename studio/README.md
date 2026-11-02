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

## Verification output (gate S2)

```
GET /                                          → 200, 14779 bytes
boot graph row                                 → dsh-video-client-pane/client.js?rev=a69b854bde50
GET /plugins/dsh-video-client-pane/client.js   → 200, 4345 bytes
✔ bundle evaluates; factory returns { apply, inject }
✔ apply() contributes 1 entry into "conversation.view" (id=studio, order=20)
✔ label thunk, session inject and first render all succeed
```
