# HyperFrames vs. Hypit — Technical Architecture Brief

*Sources: repo READMEs and docs via `raw.githubusercontent.com`, the GitHub contents API, and the Mintlify/VitePress doc sites (fetched as raw `.md` where the framework exposed it, and as HTML otherwise). Doc-page reachability is noted where it affected a claim.*

---

## TOOL A — HyperFrames (HeyGen)

### 1. What it is

An **open-source (Apache 2.0) rendering framework + CLI + agent skills + optional browser/desktop editor**, not a DSL and not a hosted app. It "turns HTML into video" ([introduction](https://hyperframes.heygen.com/introduction), [README](https://github.com/heygen-com/hyperframes)). Shipped pieces: `@hyperframes/core` (parsers, linter, frame adapters), `@hyperframes/engine` (Puppeteer + FFmpeg capture), `@hyperframes/producer` (capture→encode→audio mix), `@hyperframes/studio` + `studio-server`, `@hyperframes/player` (embeddable `<hyperframes-player>` web component), `@hyperframes/sdk`, `@hyperframes/aws-lambda`, `@hyperframes/gcp-cloud-run`.

**Core abstraction:** a plain HTML file whose timed elements carry `data-*` attributes, plus *any* seekable animation runtime registered on `window.__timelines`. The README framing: "No React requirement, no proprietary timeline format"; "HTML sets the timing, scripts do the motion" ([compositions](https://hyperframes.heygen.com/concepts/compositions)). GSAP is the first-class adapter (paused timelines, seeked never played), but CSS, Lottie, Three.js, Anime.js, WAAPI and custom adapters are supported ([frame adapters](https://hyperframes.heygen.com/concepts/frame-adapters)).

### 2. Composition format

Timing lives in HTML attributes, not in a script ([data attributes](https://hyperframes.heygen.com/concepts/data-attributes)):

```html
<div id="stage" data-composition-id="launch" data-start="0" data-width="1920" data-height="1080">
  <video class="clip" id="intro" data-start="0" data-duration="6"
         data-track-index="0" src="intro.mp4" muted playsinline></video>
  <section id="result" class="clip" data-start="intro - 0.5"
           data-duration="3" data-track-index="1">The result</section>
  <audio data-start="0" data-duration="6" data-track-index="2"
         data-volume="0.5" src="music.wav"></audio>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.from("#title", { opacity: 0, y: 40, duration: 0.8 }, 1);
    window.__timelines.launch = tl;
  </script>
</div>
```

- **Timing is absolute seconds** (`data-start="2"`), with one relational form: `data-start="intro"`, `"intro + 0.5"`, `"intro - 0.5"` = "start when that clip ends, ±n" — same-composition only, acyclic.
- **Media**: `data-media-start` (source offset), `data-playback-rate`, `data-volume`, `data-has-audio`. Nested compositions = another timed element with `data-composition-src` (fetched from a `<template>`), `data-playback-start`, `data-playback-rate`.
- **Captions are not a schema primitive** — they are ordinary per-word DOM elements animated by a GSAP timeline. A real catalog component ([caption-highlight](https://hyperframes.heygen.com/catalog/components/caption-highlight)) bakes a word table:

  ```js
  var WORDS = [
    { text: "Every", start: 0.0, end: 0.3 },
    { text: "great", start: 0.3, end: 0.55 },
    { text: "video", start: 0.55, end: 0.85 }, …
  ];
  ```

- **Tracks are editor lanes, not layers**: "Tracks are the rows the browser editor draws… Use CSS `z-index` for paint order." Two clips on one track may overlap.
- **Unit of editability:** one element with timing attributes ("a clip"), plus a nested composition as the scene unit. Reuse-per-copy is done with `data-composition-variables` / `data-variable-values`, read inside the composition by your own code — "HyperFrames does not wire `data-var-*` attributes into your DOM or CSS for you."

### 3. Rendering pipeline

Headless Chrome + FFmpeg, frame-seeking, integer math ([determinism](https://hyperframes.heygen.com/concepts/determinism)): frame clock `t = floor(frame)/fps`, frame adapter `seekFrame(frame)`, capture via `HeadlessExperimental.beginFrame` (atomic, no half-painted frames), then FFmpeg encode + audio mix. Hard rules: no `Date.now`, no `requestAnimationFrame`, no unseeded `Math.random`, no mid-render fetches, fixed fps/width/height.

Concurrency is **process-level, bounded**: `--workers 1–24` ("each is a separate Chrome, roughly 256 MB"), auto-sized by cores/memory/frame count. Local speed levers: `--experimental-fast-capture` (Chrome draw-element capture, ~2×), `--page-side-compositing` (~6× for SDR shader transitions), `--gpu` (NVENC/VideoToolbox/AMF/VAAPI/QSV), `--frames-cache-dir`.

Determinism across machines requires `--docker` (pins Chromium, fonts, FFmpeg). Cloud paths: `hyperframes cloud render` (HeyGen-managed, project zips ≤200 MB, ≥5 MB media uploaded as cached assets, 4K billed 1.5×, `--callback-url`/`--no-wait`, `--idempotency-key`) and self-hosted **AWS Lambda** (Step Functions fan-out into chunks; default reserves *no* concurrency and each render runs up to 90% of the account's unreserved concurrency; `--max-parallel-chunks`; 15-min per-invocation cap) or **GCP Cloud Run**.

**Partial/incremental render exists in three forms:** `--start/--end` (render a seconds span, output starts at 0), `--resume` with segmented capture (`HF_SEGMENT_FRAMES=3000` ≈ 100 s/segment, each segment its own ffmpeg, stream-copied at the end, "a resumed render is byte-identical to an uninterrupted one", segments hashed by everything that determines their bytes), and cloud asset-upload caching. Cost guidance is qualitative: draft/looks/delivery encode tiers; "for dev-loop iteration, stay on local `render` — the round-trip is faster than any cloud dispatch."

### 4. Agent integration

- **Skills**, not an MCP-first design: 8 published skills, 4 "core" (`/hyperframes`, `/hyperframes-cli`, `/hyperframes-registry`, `/media-use`); installed via `npx hyperframes skills update`, `npx skills add heygen-com/hyperframes`, or the Claude Code plugin marketplace (`claude plugin install hyperframes@hyperframes`). The `/hyperframes` skill "carries the render contract and the work loop."
- **The agent writes HTML/CSS/JS.** "The agent writes the HTML, CSS, and JavaScript" ([introduction](https://hyperframes.heygen.com/introduction)). The CLI is non-interactive by default, which is the stated reason agents fit.
- **Iteration loop** = `check` / `lint` → `snapshot` / `keyframes` → `preview` → `render`; plus `measure` and `diff` (SSIM against a reference) for reverse-engineering existing video.
- **Browser UI:** `npx hyperframes preview` opens the **browser editor** — Compositions/Assets on the left, canvas center, Design + Layers right, timeline below. Canvas click-to-select, drag/resize/rotate/crop, keyframes with optional auto-record, timeline move/trim/split/razor/ripple/snapping/linked-selection, Variables panel, and *caption word editing* (select a word on frame or in the rail; drag/color/size edits save to `caption-overrides.json`). Wording, timing and grouping are explicitly **not** editable there: "live in the caption source, not in the editor." A separate **Studio desktop app** (mac/Windows/Linux) runs an agent beside the preview. There is also a **hosted MCP connector** (`https://mcp.heygen.com/mcp/hyperframes/`, beta) and **WebMCP** tools registered by Studio itself (`studio_look`, `studio_select`, `studio_inspect`, `studio_set_style`, `studio_frame`) so an in-browser agent can edit and capture frames — Chrome 149/Edge 150 origin trial, Firefox/Safari not yet.

### 5. Editing model

The project folder *is* the model; there is no second source of truth. Three surfaces write to it:

- **`hyperframes timeline`** ([CLI reference](https://hyperframes.heygen.com/packages/cli)): `move/trim/split/delete/set/duplicate` on a clip ref (`#outro`), time forms `4.5`, `+1`, `30f`, `end`, `after:#intro`; `--plan` prints the diff and writes nothing; each edit returns a **receipt** that `undo <receipt>` restores; `apply <file>` takes a JSON array all-or-nothing; `ids` stamps stable ids. `hyperframes history` records who/label/files per change, with `--since mine --who claude`, `undo`, `restore`.
- **`@hyperframes/sdk`**: `openComposition(html)`, stable `data-hf-id` handles, typed edit ops, JSON patches, undo/redo, persistence adapters.
- **The browser editor / Studio**.

**Re-flow:** partial and relational. `data-start="intro - 0.5"` chains do reflow when the referenced clip's duration changes, but plain absolute-second clips do not, and caption word timings are baked numbers — there is no word-anchored reflow. The escape hatch is `hyperframes transcribe transcript.json` (replaces the transcript and "keeps the caption code around it"). **Variants** are first-class: `--variables` / `--variables-file` (typed, `--strict-variables`) and `--batch` (one output per variables row, `--batch-concurrency`, `--batch-fail-fast`).

### 6. Limitations

Node.js 22+, FFmpeg; Chrome (Puppeteer) for rendering; Docker for cross-machine byte-identical output. **License: plain Apache 2.0** — "no per-render fees or commercial-use thresholds" (FAQ confirms commercial use). Free to run locally with no account; HeyGen credits only for avatars/voices/cloud render/hosted connector. Studio app is x64-only on Windows (not Windows-on-ARM yet). Not included: no review or notes workflow, no comment threads, no project database (a folder + `history` log), no style-rule memory, no collaborative editing. `lint` warns `negative_z_index` by inspection and can false-positive. Also: the renderer stamps `hyperframes_renderer`/`hyperframes_version` container metadata (documented as strippable, explicitly "not proof of origin").

### 7. Extensibility

Three layers. (1) **Catalog**: ~450 blocks/components installed as *editable source* via `npx hyperframes add <name>`, governed by `registry-item.json`/`registry.json` schemas in `docs/schema/`. (2) **Frame adapters**: a documented contract — `seekFrame(frame)` deterministic, order-independent, `init → seekFrame* → destroy` — so a third party can wrap any animation library. (3) **npm packages**: publish a `@hyperframes/*` package (the shader-transitions package is the model), and agent-plugin ZIPs for hosts via `bun run package:agent-plugin`.

---

## TOOL B — Hypit

### 1. What it is

A **domain language (SVML) + compiler + runtime + web Studio + agent skill**, i.e. an authoring language and execution system, not a rendering engine per se (it delegates rasterization to Providers). Self-description: "gives AI agents a language and system to create video… all anchored to words instead of seconds" ([README](https://github.com/hypit-ai/hypit)). It is explicitly a *typed component graph*: every SVML element is a component that declares a Surface (inputs) and publishes typed values consumed by `{ref.field}` references.

**Core abstraction:** `Script` (prose, word-anchored meaning) → `Timeline` (absolute program time, `{id, frameRate, frameCount}`) → `Projection` (maps semantic word boundaries onto absolute Windows/Instants) → peer `Tracks` (visual/audio) → `Film` (composition) → `html:Video` (render). "SVML" is the format; `.svs` is the Recipe (style) language; `.svrun` is the Run selector.

### 2. Composition format — real snippet

From [`examples/ranking-football/reference.svml`](https://github.com/hypit-ai/hypit/blob/main/examples/ranking-football/reference.svml), the Script is prose with cue/selection markup and **no timecodes at all**:

```svml
<script id="story">
  <ronaldo>
    <HOST>Ronaldo is <D | Dee> tier. || Bro has @{hair-gel} more || hair gel
    than @{trophy} trophies || at this point.@{/trophy}@{/hair-gel} || Built like ||
    @{greek-god} a Greek god, || plays like || @{greek-tragedy} a Greek tragedy.@{/greek-tragedy}
  </ronaldo>
</script>
```

`||` = authored cue boundaries, `@{name}…@{/name}` = Selections (spans you can anchor a track to), `<D | Dee>` = Dual Text (display vs. spoken). Timing is then constructed and projected:

```svml
<time:Clock id="clock" frame-rate="30"/>
<time:Timeline id="speech" clock={clock} end="messi-semantic.end">
  <time:Window id="ronaldo-semantic" from="start" for={ronaldo-media.extent}/>
  <time:Window id="messi-semantic" from="ronaldo-semantic.end" for={messi-media.extent}/>
</time:Timeline>
<whisperx:Alignment id="ronaldo-semantic" narrative={story}
  segment={story.segment.ronaldo} media={ronaldo-media.media}
  domain={ronaldo-media.domain} language="en"/>
<semantic:Projection id="story-time" narrative={story} timeline={speech.timeline}>
  <semantic:Map alignment={ronaldo-semantic.alignment}
    domain={ronaldo-media.domain} window={speech.ronaldo-semantic}/>
</semantic:Projection>
<semantic:Window id="selection-hair-gel" projection={story-time}
  during={story.selection.hair-gel}/>
```

And picture/audio/captions are peer tracks placed by those projected windows:

```svml
<visual:Clip id="hair-gel" image={broll-hair-gel.image}
  extent={hair-gel-extent} during={selection-hair-gel}
  frame={hair-gel-frame} z="40" fit="cover"
  treatment={recipes.media.hair-gel} motion={broll-left}/>
<audio:Clip id="music-bed" source={soundtrack-media.media} during={speech.window}
  gain="0.12" fade-in="300ms" fade-out="600ms"/>
<caption-fine:Caption id="captions" document={story.caption} timing={caption-timing}
  timeline={speech.timeline} within={vertical.bounds}>
  <caption-fine:Use style={caption-style}/>
</caption-fine:Caption>
<film:Film id="main" canvas={vertical.canvas} timeline={speech.timeline}
  appearance={recipes.film.vertical}>
  <film:Track source={picture.visual}/>
  <film:Track source={mix.audio}/>
  <film:Track source={captions.visual}/>
</film:Film>
<html:Video id="final" composition={main.composition} timeline={speech.timeline}/>
```

- **Timing:** named Instants/Windows/Extents in a DAG; `from="opening.end+2s"`, `-12f` for overlap, `latest(a.end,b.end)`; `s`/`f` suffixes retained so a frame-rate change keeps frames as frames ([timing](https://hypit.ai/quickstart/timing)).
- **Word anchoring** is the whole point: clips are `during={selection-x}`, resolved from WhisperX word alignment through the projection.
- **Captions** have their own contract (`CaptionDocument` = ordered Words, N:M Alignment Units, authored Cues) and a replaceable Style family; karaoke is `off|current|trail` with `step|wipe`, and the doc insists "Timing is always whole-Alignment-Unit timing already proven by Caption. Fine never guesses internal time." ([tracks](https://hypit.ai/quickstart/tracks)).
- **Unit of editability:** the named component (a Clip, a Caption, a Window declaration, a Script Selection).

### 3. Rendering pipeline

`@hypit/html-program` compiles Composition+Timeline into one self-contained HTML document with an integer frame ABI:

```ts
window.__hypitFrameProgram.prepare(): Promise<void>
window.__hypitFrameProgram.applyFrame(frame: number): Promise<void>
```

"It never converts the request to seconds and does not require sequential playback, so independent workers can enter at any legal frame." `@hypit/provider-html-local` fans the program out "to independent Puppeteer/Chrome processes, applies absolute integer frames, muxes video frames with FFmpeg, captures PNG pixels through Chrome DevTools Protocol." Pool knobs: `workers`, `maxWorkers`, `defaultConcurrency`, `browserCapacity`, pinned `browserVersion` (Chrome for Testing). Frames must be strictly increasing but may be non-contiguous. The README's case studies state renders happen "concurrently in 64 headless Chromium processes."

**Partial render** is a first-class authoring feature: `<html:Video start-frame="240" end-frame-exclusive="360"/>` — half-open interval on the original timeline, output starts at zero, but "animation and media sampling retain their original program positions." Execution is separated from the terminal: a long-lived Worker owns Builds (`hypit build … --follow`, `hypit status --watch`, `hypit cancel`), Results land in `.hypit/results` (SQLite + files), Providers are selected through a Runtime Profile with `endpoints`/`bindings`. Local-only for execution; generation goes to hosted service partners or local WhisperX/OpenCV programs.

### 4. Agent integration

- `/hypit` skill via `npx skills add hypit-ai/hypit -g`; the agent locates or prepares the `hypit` executable ([agents](https://hypit.ai/guide/agents/)).
- **The agent writes SVML** (`.svml`, `.svs`, `.svrun`) plus, if needed, a project-local npm component package — which is why the license/package section treats "creating a component" as ordinary video work.
- **Dry-run discipline:** `hypit check main.svml` (validates imports, types, graph edges, no external calls) and `hypit plan build.svrun` ("shows the Operations it would demand. Inspect that plan before paid execution.")
- **Loop:** write → `check` → `plan` → `build` (paid generation) → `hypit studio --run build.svrun` (default port 5179) → edit or comment → re-build, reusing Outputs via `<build-record>`/`<satisfy>` in the `.svrun`.
- **Browser surface (Studio)** is a real editing app: Preview, Timeline (component Items + domain-projection "mapping and evidence rows" + a locator row for resolved Instants), Inspector whose editable fields are declared by each component's **Studio Companion**, a library with `Source`/`Tasks`/`Artifacts` views, and a **Comments** view at `#comments`: "Click the picture to play or pause, then leave a comment at the selected time. Clicking a saved note returns to that frame… Comments are saved in the project's `FEEDBACK.json`. You and your Agent can read, edit and mark them complete." ([Studio](https://hypit.ai/quickstart/preview/)). Also `hyperframes`-equivalent snapshot: `hypit snapshot --studio <url>` reads `/__studio/document`.

### 5. Editing model

The strongest of the two. Because clips reference projected windows rather than seconds, **rewriting a line re-flows its own timing and everything anchored to it**: change the Script → Alignment re-measures words on the media domain → Projection remaps → every `during={selection-…}` follows on recompile. Studio makes this explicit ([timing edits in Studio](https://github.com/hypit-ai/hypit/blob/main/docs/guide/studio-temporal-windows.md)): "Studio follows the graph to the value's producer and edits that declaration… Each drag is solved as one complete constraint… commits every required source change together." Shared Recipes/Frames explicitly affect several uses, and the UI surfaces that. Failed recompiles "restore the previous files."

**Incremental re-render** is achieved structurally rather than by segment caching: reuse accepted generation Outputs through `build-record`/`satisfy`, render only a frame interval via `start-frame`/`end-frame-exclusive`, and keep a warm Worker + warm WhisperX across Builds.

**Variants:** the repo ships direct sibling variants (`swap-host`, `swap-effect`, `swap-topic`, plus nested "banana" reuse variants) as *separate full sources* ([variants.md](https://github.com/hypit-ai/hypit/blob/main/examples/ranking-football/variants.md)). The "1 command, 100 variants" claim is a re-run-the-same-composition framing (swap the component/material), not a documented matrix/batch CLI verb — I found no `--batch`-style command in the docs I reached (see uncertainty note).

### 6. Limitations

Node 22.15+ and pnpm 10.33 hard; Python 3.10–3.13 + `uv` for local WhisperX/OpenCV; ffmpeg/ffprobe; Chrome downloaded by `hypit runtime up`. Note a **doc conflict**: [hypit.video's clone guide](https://hypit.video/guides/how-to-clone-a-video/) says "Node.js 20 or newer" while the repo dev guide says 22.15+ — trust the repo.

**License is the big one** ([LICENSE](https://github.com/hypit-ai/hypit/blob/main/LICENSE)): modified Apache 2.0 with conditions — no **multi-tenant** operation (one tenant = one workspace) and no **commercial redistribution** without written permission; forks must carry the same license and not be supplied for commercial gain; you may not remove the name/LOGO/copyright in the CLI, run reports, or manifests. Permitted without a commercial license: running it yourself, use for your own org's commercial work *including client work*, and single-tenant deployments. Outputs are unencumbered.

Paid: the OSS is free, no seat fees, no watermark; hosted generation is metered ([pricing](https://hypit.ai/pricing/): Starter $9.90/mo / 1,800 credits, Pro $49.90, Ultra $129.90, top-ups, Business custom) and BYO provider keys are supported. Maturity: pre-1.0 with migration guides (`migrations/0.3.md`, `0.3.1`). Not included: no hosted render infrastructure, no multi-tenant job service, no cloud render (compare HyperFrames Lambda/Cloud Run).

### 7. Extensibility

The most developed extension model of the two. A third party adds:
- a **component package** (Surface + Fragment + vocabulary) — `docs/guide/author-packages.md`, examples like `@hypit/comment-sticker`, `@example/chat-scene`;
- a **Recipe** in `.svs` — pure named rule blocks, no CSS cascade: "It does not implement CSS selectors, cascade or inheritance";
- a **Provider endpoint** for a capability (see `provider-whisperx-local`, `provider-monid`, `provider-pollo`, `provider-seedance`), selected in `hypit.runtime.json` via `endpoints` + `bindings`, with credentials from a store and explicit `actionLimits` for submit/poll/collect;
- a **Studio Companion** — declarative description of timeline Items and Inspector controls, binding "scalar, list or record controls" to source values, so an arbitrary component gets real editor affordances;
- everything is npm-versioned — publish under your own scope, or a versioned tarball.

---

## COMPARISON

| | **HyperFrames** | **Hypit** |
|---|---|---|
| Category | HTML→MP4 rendering framework + CLI + editor | SVML language + compiler/runtime + Studio |
| Authoring source | HTML + CSS + JS (GSAP et al.) | SVML typed component graph + `.svs` recipes |
| Timing model | Absolute seconds; `data-start="clipId ±n"` chaining | Named Instant/Window DAG; **word-anchored** via projected alignments |
| Captions | Per-word DOM elements, seconds baked in JS | `CaptionDocument` with Alignment Units + Style family; karaoke built in |
| Agent deliverable | HTML files | SVML/SVS/SVRun (+ optional npm component) |
| Agent wiring | Skills (8, core 4), Claude plugin, hosted MCP, WebMCP | `/hypit` skill, dry-run `check`/`plan`, Worker/Build |
| Browser surface | `npx hyperframes preview` editor + desktop Studio app | `hypit studio --run` (5179): Timeline, Inspector, **Comments → FEEDBACK.json** |
| Render | Headless Chrome `beginFrame` + FFmpeg; `--workers` 1–24 Chrome procs | Chrome `applyFrame` integer ABI, N independent browser procs (README: 64) |
| Determinism | Explicit contract + `--docker` pinning | Integer frames, no seconds conversion, arbitrary-order workers |
| Partial render | `--start/--end`, `--resume` (segmented, byte-identical) | `start-frame`/`end-frame-exclusive`; Output reuse via `satisfy` |
| Cloud | HeyGen cloud render, AWS Lambda, GCP Cloud Run | Local Worker only; hosted *models* only |
| License | Apache 2.0, unrestricted | Apache 2.0 **+ no multi-tenant, no commercial redistribution** |
| Extensibility | Catalog (~450), frame adapters, npm packages | npm packages: component/Recipe/Provider/Studio Companion |

**(a) Better substrate to embed in another product: HyperFrames.** The licensable one — Hypit's multi-tenant clause makes it a non-starter for a SaaS review surface unless you buy a commercial license. Beyond licensing, HyperFrames exposes a clean layer ladder ("CLI → SDK → Player → Producer → Engine → Cloud") with an explicit "choose the smallest layer" instruction ([developer overview](https://hyperframes.heygen.com/developers/overview)), an embeddable `<hyperframes-player>` for the review surface, and AWS Lambda CloudFormation for scale-out. One file format means every tool in your stack already reads it.

**(b) Better editing granularity: Hypit.** Word-anchored projection is a genuinely different class of editability from seconds-in-attributes. `during={selection-hair-gel}` survives a rewrite of the sentence; `data-start="42.3"` does not. Studio's graph-solved drags ("solves the requested move or trim through the executed relation graph and writes every required author endpoint together") beat HyperFrames' clip-level `timeline move/trim/split`, which is clean but strictly per-clip and per-second. HyperFrames' counterweights are `data-start="intro"` chaining and the receipt/`--plan`/`history` safety net.

**(c) Fits "notes → targeted re-edit → re-render":** split verdict. **Hypit** ships half of it: timestamped Comments persisted to `FEEDBACK.json`, readable and closable by the agent — that is the notes substrate, though the note→patch step is still agent improvisation. **HyperFrames** ships the other half better: cheap re-edits (`timeline` verbs with `--plan` diffs and receipts, `history`, SDK patches, `caption-overrides.json` sidecar), cheap re-renders (`--start/--end`, `--resume` byte-identical segments, `--workers`), and the WebMCP `studio_frame` primitive that lets an agent *look* at a specific frame to judge its own edit. Neither wires notes→patch→render as one loop.

**(d) Cost & licensing:** HyperFrames is free and unencumbered; you pay only for optional HeyGen credits (cloud render bills credits, 4K at 1.5×) or your own AWS/GCP. Hypit's *software* is free with no watermark and no per-render fee, but hosted generation is metered ($9.90–$129.90/mo, or bring your own provider keys and local WhisperX to spend $0), and the license restricts hosted multi-tenant use. For a product you sell, HyperFrames has zero legal friction; Hypit needs a commercial agreement.

**(e) What to borrow from each.** From HyperFrames: the determinism contract as a *published* invariant; `--plan` + receipt-based undo on every programmatic edit; `--resume`/segmented capture with content-hashed segment directories; `hyperframes history --since mine --who <agent>` as an agent-turn audit trail; the tiny `caption-overrides.json` sidecar (human micro-edits never touch the generated source); `--batch` + typed variables for variant fan-out; the Player web component and Lambda chunk fan-out. From Hypit: **word anchoring with an explicit projection step** (the single biggest architectural idea here); prose-first `Script` that contains no timecodes; the `check`/`plan` gate before any paid operation; Provider/Endpoint/binding indirection so a component never names a vendor; the **Studio Companion** pattern (a component declares its own editor affordances, so the editor never hardcodes per-component UI); and `FEEDBACK.json` as a file-based, agent-readable note store.

**(f) Gaps neither fills — an integrator must build these:**
1. **Review UI for a team.** Hypit has single-user timestamped comments; HyperFrames has none. Neither has threads, resolve states, approvals/sign-off, per-reviewer attribution, or a shareable hosted review link. (HyperFrames' `publish` command exists but its sharing semantics were not documented on the pages I reached.)
2. **Note persistence as a first-class, versioned object graph** — both drop to a flat file (`FEEDBACK.json`) or nothing; neither ties a note to the exact source revision that was rendered, so "was this fixed?" is unanswerable without you diffing.
3. **Style-rule memory / taste store.** HyperFrames' `frame.md`/`DESIGN.md` and Hypit's `.svs` Recipes are per-project; neither accumulates "our brand forbids captions over faces" across projects as enforceable rules the agent must satisfy.
4. **Visual-regression gate on re-edit.** HyperFrames has `diff`/`compare`/`grade-compare` (SSIM) but opt-in and reference-driven; Hypit has none. Neither blocks a re-render on unintended collateral change.
5. **Project database, asset library, and render manifest** as a queryable service — both are folder + local cache (`history`/`.hyperframes` vs `.hypit/results` SQLite).
6. **Cost governance.** Hypit's plan-before-spend is the closest thing; neither enforces per-project budgets or attributes spend to a note/change.
7. **Multi-tenant isolation.** The integrator's problem in both cases; and in Hypit's case, contractually restricted.

---

### Uncertainty notes

- **`https://developers.heygen.com/hyperframes-overview`** is behind HeyGen's docs assistant and rendered only as script-heavy HTML; I confirmed it is the same "Introduction to Hyperframes" content as `https://hyperframes.heygen.com/introduction` and used the Mintlify `.md` sources instead.
- **HyperFrames "Pro"** is referenced once in the README (the `/reverse-any-video` skill is "HyperFrames Pro") but no pricing/plan page was reachable on the doc site I crawled; treat that tier as undocumented here.
- **Hypit has no documented batch/variant command** in the docs reached (`docs/quickstart/*`, `docs/guide/*`, `examples/*/variants.md`); "1 command, 100 variants" is marketing framing. Per-variant *sources* are verified; a fan-out verb is not.
- **Hypit "64 headless Chromium processes"** comes from README case-study captions, not a benchmark doc.
- **`https://hypit.ai/guide/develop/`** and `https://hypit.ai/quickstart/` were read from their VitePress sources (`docs/guide/develop.md`, `docs/quickstart/*.md`); the live pages matched on spot check.
