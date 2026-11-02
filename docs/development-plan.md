# DSH Studio — Agent-First Video Editing on DeepSeek Harness

**Development Specification · v1.0 (for review — no code written yet)**

| | |
|---|---|
| Document owner | System architecture (prepared for the dev team) |
| Status | **Approved for build (v1.1).** Sections 5–11 are the implementable contract; §12 is superseded for execution by [`build-plan.md`](./build-plan.md), and live progress is in [`build-state.md`](./build-state.md). §16 tracks the questions that can still change the design |
| Audience | 1–3 developers + AI coding agents working inside the DSH checkout |
| Companions | `reference/transcript2.txt` (source analysis), `reference/prompt.txt` (original brief), [`hyperframes-vs-hypit-brief.md`](./hyperframes-vs-hypit-brief.md) (deep competitor evidence, 248 lines), [`build-plan.md`](./build-plan.md) (the agent's execution plan) |
| Target platform | DeepSeek Harness, `web` profile, out-of-tree plugin bundle. Models: `deepseek-v4-flash` (bulk), `deepseek-v4-pro` (planning), `deepseek-v4-flash-vision-exp` (frame QA) |
| One-line thesis | **Make the edit a data structure, make the segment the unit of rendering, and make the review pane a first-class DSH surface.** Everything else follows. |

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Reverse engineering the reference workflow](#2-reverse-engineering-the-reference-workflow)
3. [Product requirements](#3-product-requirements)
4. [Competitive analysis: HyperFrames vs Hypit, and where we sit](#4-competitive-analysis-hyperframes-vs-hypit-and-where-we-sit)
5. [System architecture](#5-system-architecture)
6. [Data model](#6-data-model)
7. [The resolver contract and its invariants](#7-the-resolver-contract-and-its-invariants)
8. [Module specifications](#8-module-specifications)
9. [Model-facing contracts: tools, commands, skill](#9-model-facing-contracts-tools-commands-skill)
10. [The Studio pane (UI specification)](#10-the-studio-pane-ui-specification)
11. [Model routing, tokens and cost](#11-model-routing-tokens-and-cost)
12. [Delivery plan](#12-delivery-plan)
13. [Test strategy](#13-test-strategy)
14. [Risks and mitigations](#14-risks-and-mitigations)
15. [Decision log](#15-decision-log)
16. [Open questions for review](#16-open-questions-for-review)
17. [Appendix A — Glossary](#appendix-a--glossary)
18. [Appendix B — Reference stack and install commands](#appendix-b--reference-stack-and-install-commands)

---

## 1. Executive summary

### 1.1 What we are building

**DSH Studio** is a DSH-native video editing system. A creator drops raw footage into the DSH web GUI, tells the agent "edit this in my personal reel style", and gets back a reviewable timeline. The creator never leaves the browser: they scrub a real video, drag a caption box, type (or dictate) notes pinned to exact seconds, hit **Send notes**, and the agent re-edits *only the affected pieces* and re-renders *only the affected seconds* before a final export.

Three things make it different from "a prompt that wraps ffmpeg":

1. **The edit is data, not a script run.** Every project is an `edl.json` — a word-anchored edit decision list. Rendering is a pure, deterministic function of `(edl, style, assets, render profile)`. This is what makes "edit a piece before the final render" possible at all.
2. **The segment is the unit of rendering.** Renders are content-addressed per segment. A note that touches 4 seconds of a 3-minute video re-renders ~4–8 seconds of output plus a near-instant concat. Editing cost scales with *what you touched*, not with video length.
3. **The review pane is a DSH client plugin.** It is a real surface in the GUI (`conversation.view` slot), sharing the session, the agent, the approval gate and the job system — not a separate app bolted on.

### 1.2 Why DSH is the right substrate (and where it constrains us)

| DSH capability | What we get for free | Consequence for this design |
|---|---|---|
| Session log as source of truth; every model-visible fact is a session event | Notes, review submissions and edit intents are durable, replayable, forkable | Notes are **session events first**, files second — the agent can never "lose" a note |
| Tools / `ctx.tools`, `tools/pre-execute` gating, sandbox + approval policy | Render and file-mutating tools inherit the same policy as `write`/`bash` | One approval story for the whole product; no bespoke permission system |
| `ctx.jobs` + `job_output` / `job_kill` | Long renders survive, stream progress, and wake the agent on completion | Renders are background jobs; the agent reports back without polling |
| Subagents + `workflow` | Batch of 7 videos = 7 child sessions sharing one style | The reference video's "two and a half hours for seven videos" becomes a fan-out |
| `ctx.slots` client plugins + `ctx.webServer` routes | A real pane inside the GUI, plus our own HTTP route for media | Pane is native, media streaming is ours to build (see 5.4) |
| Three DeepSeek models incl. a **vision** model | Cheap bulk reasoning *and* cheap visual self-QA | "Text never covers my face" becomes an enforced, checkable rule |
| Skills (`.dsh/skills/<name>/SKILL.md`) | Project-local, hot-reloaded instruction bundles | The editing style is a skill **plus** machine-checkable rules (§6.6) |

Known constraints we must design around (verified in the checkout, not guessed):

- **No `Range` request support anywhere in DSH today.** The only file server buffers whole files. Video scrubbing therefore requires a host-side plugin route we own (`ctx.webServer.register({kind:'prefix', path:'/video'})`).
- **Adding a new typed `/remote` namespace requires editing the DSH repo** (`packages/api/remotes/src/client/index.ts` is a build-time-fixed array). We stay out-of-tree: pane ↔ host talks over **our own HTTP route + SSE**, with types shared through a TS package. The lower-level `ctx.connection.rpc.handle('/video', …)` channel is contract-complete but has no production consumer in-tree; it is our documented fallback, not our first choice.
- **Client bundles may not import other `@deepseek-ai/*` values** (build-time purity gate). Shared logic goes in **our own** package, and third-party npm deps (GSAP, etc.) are fine.
- **Plugin install requires a restart**; the client module scan runs once at boot. `pnpm run dev:web` gives per-plugin HMR for the pane bundle only.
- **No auth/TLS in DSH web.** v1 is loopback-only; a future team deployment sits behind a reverse proxy (§5.8).

### 1.3 What v1 must prove (the seven demos)

The build is done when these seven run end to end, in this order:

| # | Demo | Proves |
|---|---|---|
| D1 | Drop a 4-minute talking-head clip → agent produces a 45s vertical short with karaoke captions, a zoom, B-roll and music | The core loop |
| D2 | Open the Studio pane, scrub, add 5 notes at exact seconds, **Send notes** → agent applies them | Review loop |
| D3 | Only 3 segments re-render; total wall time under 60s; the other 30 segments show `cached` | **Segment-level incremental rendering** (the headline requirement) |
| D4 | Drag a caption box 40px left in the pane → instant local preview → one-click verify render of that 2s window | Direct manipulation without full re-render |
| D5 | Say "when there's a full-screen animation, don't add captions" → rule is written, a *different* video is linted and the violation is caught automatically | Style memory as **policy**, not prose |
| D6 | Take a 14-minute YouTube video → 3 vertical reels, each with its own hook + captions + reframe | Long-form → short-form derivation |
| D7 | **Approve and final render** at 1080p → single MP4 + manifest + optional SRT/thumbnail | Delivery, with a full provenance record |

### 1.4 Effort reality check

The brief asks for four content formats (short-form, long-form, screen recording, podcast/multi-cam), direct manipulation, style learning and AI asset generation, with **one dev and "as fast as possible"**. That combination is not a 4-week project; it is ~10–14 weeks of one developer's focused work if done in the order below. §12 therefore proposes a **scope ladder** with a hard MVP cut at the end of week 3 (D1–D3), and asks you to confirm the ladder in §16-Q1 rather than silently dropping requirements.

---

## 2. Reverse engineering the reference workflow

### 2.1 The loop, as performed in the transcript

The creator is not using a video editor. He is running a **director's loop**: he sets a style once, delegates execution, reviews against a proxy, leaves timestamped notes, and re-approves. Reconstructed stage by stage (line references are to `reference/transcript2.txt`):

| # | Stage | Observed mechanics | What the human actually decides |
|---|---|---|---|
| 1 | Ingest | Airdrop the raw file onto the machine, drag it into a coding-agent session (L312–319). Batches of 8 at a time (L314–318) | Which file, which style |
| 2 | Transcribe | ElevenLabs ("22 cents per hour", L84–92); word-level, because captions are word-timed | Nothing — mechanical |
| 3 | Cut | "cut every pause, every fail take" (L207–208); throat-clearing, looking-around silent video (L292–294) | Nothing — mechanical |
| 4 | Captions | "caption, one line just under my chin" (L209); "Text never covers my face" (L217); "big font that is Ivy Presto doesn't stay on screen long enough… make sure there's a little hang" (L420–430) | Style, expressed as rules |
| 5 | Graphics / templates | 20+ templates: business reels, personal reels, explainer, coaching clips, split-screen, B-roll + stack text, fitted captions, image cluster (L252–268) | Which template |
| 6 | B-roll | Chosen from a library against the spoken line; "each one should go where my finger is… they need to be smaller… don't make them directly cover my face like eyes" (L378–389) | Placement policy |
| 7 | Audio | "music 25 decibels under my voice" (L210–211); "increase the music instrumental by two decibels" (L489) | Loudness target |
| 8 | Proxy render | 720p render **specifically so notes can be left** (L166–169, "it's just a lot faster than 4K") | Nothing — a latency decision |
| 9 | Review | Browser pane "almost like Frame.io" (L361–363); notes at exact seconds, dictated by voice (L373–390) | Every creative correction |
| 10 | Apply | "Send notes to Claude" (L494–505); agent re-runs, re-renders | Nothing |
| 11 | Final | 1080p export, upload or AirDrop to phone (L168–174) | Approve |

### 2.2 The five mechanisms that actually make it work

Strip the marketing and five load-bearing ideas remain. They are the requirements we are reverse-engineering, so each one is mapped to a design element later in this document.

1. **A persistent style artifact, written in imperative rules, mutated by feedback.** "You should tell it to create a skill… a list of rules and guidelines that it's going to follow every single time" (L201–216), and after every fix: "I always say save it to the skill just to make sure that it saves it to the skill and it never messes up again" (L227–230). → §6.6 style = prose skill **+ executable rules**.
2. **Time-anchored, target-typed review notes.** Not "make the captions better" but "at 0:14, the B-roll should be smaller and sit where my finger is". → §6.5 notes carry `t`, `targets[]`, `intent`, and a resolution state.
3. **A deliberately cheap, deliberately fast proxy render as the review currency.** 720p exists to shorten the loop, not to look good (L166–170). → §5.6 two-grade rendering (preview 540p / final 1080p) and §5.5 segment cache.
4. **Templates as reusable constraints, not as a one-shot prompt.** 20 templates, each a bundle of layout + typography + motion + B-roll policy. → §6.6 presets + §8.6 preset library.
5. **Batch fan-out with subagents.** "It will do agent subagents to cut all seven videos… a subagent for the graphics, a subagent for the captions" (L571–580). → §5.7 jobs + subagents, §9.6 batch protocol.

### 2.3 The reference's real cost and latency (and what it hides)

| Metric | Reference claim | Notes / what it hides |
|---|---|---|
| Human editor | $5–15 / $30–50 / $150 per short; $150–500 per YouTube video (L50–80) | Real market anchor: 30 shorts + 4 long = **$2,100/month** (L118–128) |
| AI stack | $100/mo Claude Max + $0.22/hr transcription + free HyperFrames/FFmpeg (L82–103) | ≈ $3/video (L103–106) |
| Usage | 16 shorts ≈ 22% of a weekly Max quota (L107–116) | ~70–100 shorts/week ceiling on one $100 seat |
| Latency | "that took about 30 minutes" for one short (L354) | 30 min is *agent wall time*, not render time; the human is idle by design |
| Batch | "two and a half or three hours for seven videos" (L577–580) | Nonlinear, because of subagent contention |
| Hidden cost | Human review attention: 7 notes, watched twice (L479–520) | **This is the bottleneck.** Our pane exists to reduce *review* time, not render time |

**The real insight to steal:** the human's scarce resource is *attention during review*, and the system's scarce resource is *the wall-clock of a full re-render*. The reference solves the first (720p proxy) but not the second — every note round re-runs the whole edit. Our segment-level rendering is the fix for the second, and the pane's direct manipulation is the fix for the first.

### 2.4 Six deliberate deltas from the reference

| Delta | Reference | DSH Studio | Why |
|---|---|---|---|
| D1 | Agent re-runs the whole pipeline per note round | Resolve → diff → re-render **dirty segments only**, concat from cache | Turns an 8-minute round into <60s; makes iteration cheap enough to be habitual |
| D2 | Style lives as English prose in a skill file | Prose **+ typed rules with code-backed validators** | "Never makes the same mistake again" becomes true, not hopeful |
| D3 | 720p proxy only; creative geometry judged by eye | Live **DOM composite** in the pane + cheap **single-frame** renders + vision-model QA | See the exact frame, not a re-render, before committing |
| D4 | Notes are free text in a review app | Notes carry machine targets (`clip:c-07`, `item:t-12`, `word:w-0311`) and resolve to EDL patches | Removes the agent's guessing step; cheaper model becomes viable |
| D5 | One model for everything (Opus High) | Flash for mechanics, Pro for planning, Vision-Flash for QA, with a per-project budget guard | ~10–30× cheaper at equal quality for the mechanical 80% |
| D6 | Everything inside one chat session | Session + **project folder** with EDL, notes, style, render manifest | Forkable, diffable, testable, reviewable in git; survives a crashed session |

---

## 3. Product requirements

### 3.1 Personas

- **P1 — Operator/creator (primary).** Edits their own content, 5–35 videos/week, wants to stop touching a timeline. Judges output on *taste* and *speed of the review loop*. Does not read code.
- **P2 — Agent (primary, non-human).** Needs small, unambiguous, idempotent tools and compact state digests. Its "UX" is the tool schema and the digest format.
- **P3 — Future team member / client reviewer (deferred).** Wants to leave notes on a shared link. v1 must not architecturally block this, but implements none of it.

### 3.2 Functional requirements

Priority: **M** = must (v1), **S** = should (v1.5), **C** = could (v2). Grouped by subsystem; each ID is referenced by the delivery plan in §12.

#### Ingest and analysis
| ID | Requirement | P |
|---|---|---|
| FR-01 | Create a project from one or more source files; reference sources in place (no copy by default), record `sha256`, duration, dimensions, fps, audio presence | M |
| FR-02 | Generate an editing proxy ladder per source: `270p` all-intra (scrub), `540p` CFR (preview render input), original for final | M |
| FR-03 | Extract audio to 48 kHz PCM for analysis and mixing | M |
| FR-04 | Word-level transcript with per-word `start/end/confidence/speaker`, from a **hosted ASR API behind a provider seam** (default: ElevenLabs Scribe; alternates: Deepgram, Groq/OpenAI Whisper-compatible). Local whisper stays available as an offline fallback, not the default | M |
| FR-05 | Silence/VAD map and audio energy envelope | M |
| FR-06 | Face-bbox track sampled at 2–5 fps (feeds safe-zone constraints and 16:9→9:16 reframe) | M |
| FR-07 | Beat grid from music analysis | S |
| FR-08 | Speaker diarization for multi-speaker sources | S |
| FR-09 | Idempotent: re-running analysis never redoes completed work; keyed by source hash + tool version | M |

#### Edit model
| ID | Requirement | P |
|---|---|---|
| FR-10 | Edit decision list (`edl.json`) as the single source of truth, versioned by monotonic `rev` | M |
| FR-11 | Every timing value is an **anchor** (word / silence-edge / beat / explicit time), never a bare second, unless explicitly authored as `time` | M |
| FR-12 | Program timeline resolution: anchors → absolute frames via one shared resolver used by host *and* browser | M |
| FR-13 | Patch API: apply a list of typed ops (`cut.trim`, `clip.remove`, `text.add`, `text.setBox`, `text.retime`, `visual.add`, `audio.gain`, `effect.zoom`, `rule.add`, …) with `dryRun` returning a diff, and atomic all-or-nothing application | M |
| FR-14 | Every patch records: who (agent/user), why (note ids), resolver diff, and resulting `rev`. Undo = apply inverse patch | M |
| FR-15 | Dangling anchors (word no longer in any kept clip) are detected and reported, never silently dropped | M |
| FR-16 | Multiple output targets per project (9:16, 1:1, 16:9) resolved from one EDL | M |
| FR-17 | Derivations: a vertical reel extracted from a program window of a long-form EDL, with its own overrides and reframe path | M |

#### Rendering
| ID | Requirement | P |
|---|---|---|
| FR-20 | Render scopes: `stills` (N frames), `segment` (frame range), `preview` (whole timeline, 540p), `final` (whole timeline, target profile) | M |
| FR-21 | Content-addressed segment cache; a rebuild of an unchanged segment is a cache hit reading from disk | M |
| FR-22 | Dirty-interval computation from resolver diffs, expanded for transitions, snapped to segment boundaries | M |
| FR-23 | Assembly (concat) of cached segments into a seamless MP4 without re-encoding video | M |
| FR-24 | Audio always re-mixed per revision (cheap, seam-free), with voice/music/SFX buses and loudness normalisation | M |
| FR-25 | Deterministic output: same `(edl rev, style, profile)` ⇒ byte-identical file | M |
| FR-26 | Render manifest per revision: segment keys, cache hits, renderer + version hashes, wall time, output hash | M |
| FR-27 | Interrupt safe: killing a render leaves completed segments in cache; resume costs nothing extra | M |
| FR-28 | Parallel segment rendering with a bounded worker pool; progress streamed to the pane | M |
| FR-29 | Tiered rendering: FFmpeg-only path for cut/caption-presets that need no DOM; Chromium path (HyperFrames) for motion graphics | M |
| FR-30 | Optional 4K final profile | C |
| FR-31 | Hardware-accelerated encode when available (VideoToolbox on macOS) | S |

#### Review pane
| ID | Requirement | P |
|---|---|---|
| FR-40 | Studio tab in the web GUI, per session, alongside Chat | M |
| FR-41 | Playback of the 270p proxy with all overlays composited live in the browser at program time | M |
| FR-42 | Timeline: clip bands, text/visual/audio bands, note pins, segment states (fresh/stale/rendering), playhead | M |
| FR-43 | Add a note at the current time, bound to the clicked/selected target; edit, delete, resolve | M |
| FR-44 | "Send notes" submits a review batch → durable session event → agent turn | M |
| FR-45 | Drag/resize/rotate a text or visual overlay; position commits as a typed patch, visible instantly | M |
| FR-46 | Per-overlay inspector (preset, word group, motion, z, safe-zone flags) | M |
| FR-47 | Range-scoped render button: "render what changed" and "render this window" | M |
| FR-48 | Side-by-side compare of two revisions (previous render vs current) | S |
| FR-49 | Inline display of lint/QA findings as overlay badges | M |
| FR-50 | Keyboard-first: `space` play, `n` note, `[`/`]` note nudge, `s` split preview at playhead | S |
| FR-51 | Shareable read-only review link for a client | C |
| FR-52 | Mobile-safe layout, touch scrubbing | C |

#### Style, rules and QA
| ID | Requirement | P |
|---|---|---|
| FR-60 | Project style bundle: prose `skill.md` (agent-facing) + `rules.json` (machine-checkable) + presets | M |
| FR-61 | Built-in rule catalogue with code-backed validators: caption/face overlap, caption over full-screen, min on-screen time ("hang"), lead-in, music-vs-voice level, text inside title-safe, caption line count, headroom, B-roll duration bounds, no unlicensed-referenced asset, loudness target | M |
| FR-62 | `style_learn`: turn a note or an agent conclusion into a rule, with a preview of which existing revisions would violate it | M |
| FR-63 | Rule violations block "final" render (soft-block with explicit override) and never block preview | M |
| FR-64 | Repeated-note detection: when the same correction appears 2× the agent proposes promoting it to a rule | S |
| FR-65 | Vision QA pass on a contact sheet of risky frames, returning structured findings | M |
| FR-66 | Style bundles exportable/importable across projects (global + project scope) | S |

#### Assets, delivery, batch
| ID | Requirement | P |
|---|---|---|
| FR-70 | Local asset library (B-roll, stills, SFX, music) indexed by tags, duration, aspect, licence; searchable by the agent | M |
| FR-71 | AI-generated stills/B-roll as an asset *source* behind a spend guard, cached by prompt+seed | S |
| FR-72 | Delivery: MP4 + SRT/VTT + thumbnail + poster frame + a `delivery.json` manifest in an exports folder | M |
| FR-73 | Batch: N sources × one style → N independent projects rendered in parallel with per-project budgets | S |
| FR-74 | Upload to Drive/YouTube/TikTok | C |

#### Agent-facing surface
| ID | Requirement | P |
|---|---|---|
| FR-80 | ≤10 model-facing tools, each idempotent, all returning compact digests | M |
| FR-81 | A `video-editing` skill that carries the workflow contract, the EDL format reference and the tool usage loop | M |
| FR-82 | Slash commands: `/video` (open/status), `/render`, `/notes` | S |
| FR-83 | The agent never has to read a full EDL or a full transcript into context (§9.4) | M |
| FR-84 | Every tool result is replayable from the session log alone | M |

### 3.3 Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | Note-round latency (5 notes on a 60s short) | ≤ 60s wall clock, p90 |
| NFR-02 | Scrub responsiveness in the pane | ≥ 50 fps overlay compositing; ≤ 120 ms seek latency on the 270p proxy |
| NFR-03 | Full 60s preview render (540p, from scratch) | **Measured basis:** T0 ≈ 0.6× realtime (36 s); T1 ≈ 0.13–0.17× realtime + 13.6 s fixed → a 60 s Chromium-only preview is ≈ 5–7 min at 2 workers. Target: **≤2 min for T0-dominant projects, ≤7 min for T1-heavy ones** on the dev machine |
| NFR-04 | Full 60s final render (1080p) | **≤ 8 min** (revised from 5 after measuring 5.9 s of wall time per output second at 1080p on the T1 path). T0 path: 14.2 s for 24 s of 1080×1920 (**0.59× realtime**), 0.44 s to reassemble 4 cached segments — concat-only when everything is cached |
| NFR-05 | Single-frame render latency (direct-manipulation verify) | ≤ 2s |
| NFR-06 | Determinism | Byte-identical for identical inputs on the same machine + pinned Chromium |
| NFR-13 | **Render throughput floor (the machine we have today)** | 1080p 9:16 T0 encodes at ≥0.5× realtime; **≤ 2 Chromium workers** (8 GB RAM); the product must hit NFR-01 on T0-only projects, and Chromium-heavy projects must degrade by rendering preview at 540p rather than by failing |
| NFR-07 | Crash safety | No lost work: EDL, notes and segment cache are all crash-consistent |
| NFR-08 | Cost | See §11; hard per-project token and render-minute ceilings |
| NFR-09 | Privacy | **Audio (not video) is sent to the ASR provider** — an explicit, per-project disclosure. Video frames leave the machine only if vision QA is enabled. Nothing else (footage, renders, EDL, notes) is ever uploaded |
| NFR-10 | Portability | macOS first (arm64), Linux second; Windows best-effort in v1 |
| NFR-11 | Testability | Resolver and diff are pure and 100% unit-tested; render correctness gated by golden frames (§13) |
| NFR-12 | Observability | Every render/analysis step emits structured timing + a job log; `~/.dsh` untouched by product data |

### 3.4 Out of scope for v1

Multi-user auth and sharing links · real-time collaboration · live-studio / streaming · timeline NLE editing (trim/drag clips *as the primary* interaction — see §16-Q3) · subtitle translation · music licensing automation · 4K/HDR delivery · Instagram/TikTok upload · mobile app · Remotion or After Effects import.

---

## 4. Competitive analysis: HyperFrames vs Hypit, and where we sit

*Full evidence, quotes and uncertainty notes: [`hyperframes-vs-hypit-brief.md`](./hyperframes-vs-hypit-brief.md). Condensed decision-relevant version below.*

### 4.1 They are different species

- **HyperFrames** (HeyGen, Apache-2.0, [repo](https://github.com/heygen-com/hyperframes), [docs](https://hyperframes.heygen.com)) is a **rendering framework + CLI + agent skills + a browser/desktop editor**. Authoring source is plain HTML: timed elements carry `data-start` / `data-duration` / `data-track-index`, and any seekable runtime registered on `window.__timelines` drives the motion (GSAP is first-class). Rendering is headless Chrome frame-seeking (`HeadlessExperimental.beginFrame`) + FFmpeg, with an explicit determinism contract, `--workers 1–24`, `--start/--end`, `--resume` with content-hashed segments, `--batch` + typed variables, and cloud render on HeyGen/AWS Lambda/GCP Cloud Run.
- **Hypit** ([repo](https://github.com/hypit-ai/hypit)) is a **domain language (SVML) + compiler + runtime + Studio**. Authoring source is a typed component graph: prose-first `Script` (no timecodes, `||` cue boundaries, `@{selection}` spans) → `Timeline` → `whisperx:Alignment` → **`semantic:Projection`** → peer `visual:`/`audio:` tracks placed by `during={selection-x}` → `Film` → `html:Video`. Captions have their own contract; karaoke is built in; `<html:Video start-frame end-frame-exclusive>` renders an interval with an integer frame ABI designed for arbitrary-order workers; Studio has a real Timeline/Inspector and timestamped comments persisted to `FEEDBACK.json`.

### 4.2 Head-to-head

| | **HyperFrames** | **Hypit** |
|---|---|---|
| Category | Rendering framework + editor | Language + compiler + runtime + studio |
| Editability unit | One timed element ("clip"); nested composition as scene | One named component / projected window / script selection |
| Timing model | **Absolute seconds** + `data-start="clip ±n"` chaining | **Word-anchored**, via an explicit projection step |
| Re-flow on text change | No (caption word times are baked numbers) | **Yes** — rewrite a line, everything anchored to it re-times on recompile |
| Captions | Not a primitive — per-word DOM + JS word table | `CaptionDocument`: Words, N:M Alignment Units, Cues, karaoke styles |
| Partial render | `--start/--end`, `--resume` byte-identical segments | `start-frame`/`end-frame-exclusive`, Output reuse via records |
| Browser surface | Sketch/editor with canvas + timeline + `caption-overrides.json`; agent-facing WebMCP frame tools | Studio: Timeline, Inspector, Comments → `FEEDBACK.json` |
| Review/notes | **None** | Single-user timestamped comments, agent-readable |
| Determinism | Explicit contract; `--docker` for cross-machine byte equality | Integer frames, no seconds conversion |
| Extensibility | ~450-block catalog, frame adapters, npm packages | Component packages, Recipes (`.svs`), Providers, **Studio Companion** |
| Licence | **Apache 2.0, unencumbered** | Apache 2.0 **+ no multi-tenant, no commercial redistribution** without a licence |
| Cloud render | HeyGen cloud, Lambda, Cloud Run | Local worker only |

### 4.3 Verdicts on the three questions that matter to us

1. **Which is the better substrate to build on? HyperFrames — decided by licence, not by architecture.** Hypit's modified Apache 2.0 forbids multi-tenant operation ("one tenant = one workspace") and commercial redistribution without written permission. Even for a local-first product that may later become a hosted team product (your stated deployment answer), that is a legal landmine. HyperFrames is unencumbered, exposes a documented layer ladder (CLI → SDK → player → producer → engine), ships an embeddable `<hyperframes-player>`, and already has `--start/--end` + `--resume` — precisely the primitives our segment cache needs. **[ADR-003]**
2. **Which has the better editing granularity model? Hypit, clearly.** Word-anchored projection is a different class of editability: `during={selection-hair-gel}` survives a rewrite of the sentence; `data-start="42.3"` does not. **We adopt the idea without the code**: our EDL is word-anchored with an explicit projection step (§6.4, §7). This is the single most valuable thing to borrow, and it is a *design pattern*, not a dependency.
3. **Which wires notes → re-edit → re-render end to end? Neither.** Hypit has the notes substrate but no note→patch automation; HyperFrames has cheap edits (`timeline` verbs with `--plan` diffs and receipts, `history`, SDK patches, `caption-overrides.json`) and cheap re-renders, but no review surface at all. **That gap is our product.**

### 4.4 What we borrow, concretely

From **HyperFrames**: the determinism contract as a published invariant; `--plan`-style dry-run diffs with receipts on every programmatic edit (→ our patch API returns a diff *before* applying); `--resume`'s content-hashed segment discipline (→ our segment cache); `caption-overrides.json`'s separation of human micro-edits from generated source (→ our `overrides` layer that never touches the resolver's inputs); `--batch` + typed variables (→ our derivation/variant model); the player component as a fallback for a future hosted review page.

From **Hypit**: word anchoring with an explicit projection step; a script that contains **no timecodes**; `check`/`plan` gates before expensive operations (→ our `dryRun` + budget guard); provider/endpoint indirection so no component names a vendor (→ our renderer seam, §5.5); the **Studio Companion** pattern where a component declares its own editor affordances (→ our `preset.describe()` inspector schema, §8.6); `FEEDBACK.json` as a file-based, agent-readable note store (→ our notes as session events + file mirror).

### 4.5 What neither does — our moat

| Gap in both | Our answer |
|---|---|
| Review UI with targets, states and revision provenance | Studio pane + notes bound to `rev` + `resolvedInRev` (§6.5) |
| Notes tied to the exact rendered revision | Every note stores the `rev` it was made against and the EDL diff that closed it |
| Cross-project style memory that is *enforceable* | `rules.json` with code-backed validators (§6.6) |
| Visual-regression gate on re-edit | Dirty-interval minimality invariant + golden-frame diffing (§7.3, §13) |
| Queryable project/asset/render database | `project.json` + storage domain + render manifest (§6.7) |
| Cost governance | Per-project token/render budget with pre-spend `plan` (§11.4) |
| **Agent operates on a cheap model without losing quality** | Digest-first tool design + deterministic geometry math + vision QA (§9.4, §11) |

---

## 5. System architecture

### 5.1 Distribution and install shape

One out-of-tree npm workspace, installed into a DSH profile as a **bundle**:

```sh
cd dsh-video
dsh plugin --profile studio add ./packages/bundle   # adds the bundle layer + dependencies
dsh plugin --profile studio add @deepseek-ai/dsh-base@<pinned>   # (base comes first automatically)
dsh --profile studio --dump-config                  # verify the layer composed
dsh --profile studio web                            # boot; Studio tab appears
```

```
dsh-video/                                  pnpm workspace root
  packages/
    bundle/            # package.json declares dsh.bundle -> cordis.patch.yml  (the install surface)
    core/              # EDL schema + resolver + diff + layout solver. PURE: no Node, no React
    presets/           # preset library, motion timelines, rule validators registry (pure)
    host-ingest/       # ffprobe, proxies, audio extract, transcription, faces, silence, beats
    host-render/       # renderer seam: FFmpeg + HyperFrames drivers, segment cache, assembler
    host-style/        # rule engine, style memory, "promote note to rule"
    host-qa/           # deterministic lint + vision contact-sheet QA
    host-tools/        # the ≤10 model-facing tools
    host-server/       # /video HTTP API, SSE events, Range media route
    client-pane/       # the Studio pane — ONE client bundle
    skill/             # SKILL.md + references, shipped as package resources
```

**Dependency rules (enforced in review, and by a lint script):**

1. `core` and `presets` may import only each other, plus pure utility libs. **No `node:*`, no React, no `@deepseek-ai/*`.** They are the shared brain and get bundled into both faces.
2. `host-*` packages may import `core`/`presets`, `node:*`, and `@deepseek-ai/*` host services.
3. `client-pane` may import `core`/`presets` (bundled) and third-party browser deps (GSAP, React is provided by the shell). It may **not** import any `@deepseek-ai/*` value except the whitelisted externals — the DSH build has a hard gate for this.
4. `host-*` must never import `client-pane`, and vice versa; the only coupling is the versioned wire types in `core/wire.ts`.

> **This is a real risk, not a formality.** Out-of-tree client bundles must be built with the DSH client artifact contract — a CJS closure factory registered as `window.__ModuleLoader__.load({ id, factory: (require) => { … return module.exports } })`, with CSS injected at first `require`. DSH's own preset lives at `packages/client/tsdown.client.ts:555-565` in the checkout. **Spike S2 (§12.1) is to reproduce that contract out-of-tree and boot a hello-world pane**, before any UI work is planned in a sprint.

### 5.2 Three planes

```
┌──────────────────────── CONTROL PLANE (agent) ─────────────────────────┐
│ DSH session · agent loop · tools · skill · subagents · jobs · approval  │
│  video_project  video_analyze  video_edl_*  video_render  video_notes   │
│  video_frames   video_lint     video_style_learn  video_assets  video_deliver │
└───────────▲───────────────────────────────────┬────────────────────────┘
            │ digests, patches, job results     │ tool calls
┌───────────┴───────────────────────────────────▼────────────────────────┐
│ DATA PLANE (project folder on disk)                                    │
│  edl.json (rev)  notes.jsonl  style/{skill.md,rules.json,presets/}      │
│  analysis/{transcript,faces,silence,beats,speakers}.json                │
│  media/{source,proxies,audio,assets}   render/{cache,preview,final}     │
└───────────▲───────────────────────────────────┬────────────────────────┘
            │ resolved timeline + segment state │ resolved timeline
┌───────────┴───────────────────────────────────▼────────────────────────┐
│ PRESENTATION PLANE (Studio pane, browser)                              │
│  <video 270p proxy> + DOM overlays @ program time + notes rail +      │
│  timeline bands + per-overlay inspector + drag→patch                   │
└────────────────────────────────────────────────────────────────────────┘
```

The load-bearing rule: **the data plane is the only shared state; every plane derives from it.** The pane never holds authoritative state (it holds UI state only); the agent never holds authoritative state (it holds a digest plus a patch intent). That is what makes "edit a piece" safe.

### 5.3 Runtime topology

| Unit | Where | Lifetime | Notes |
|---|---|---|---|
| `host-server` route | DSH host Node process | process | `/video/*`, `/video/events` SSE |
| Analysis/render work | child processes via `ctx.jobs` | job | ffmpeg/ffprobe/chromium local + one HTTPS call to the ASR provider; cancel via `job_kill` |
| Pane | Browser (client bundle) | page | one per session view; HMR-able |
| Resolver | Both host and browser | call | same code, same output (a hard invariant, §7) |
| Project lock | `<project>/.lock` (flock) | critical section | one writer per project; readers always allowed |

### 5.4 Transport: why not `/remote`

Verified in the checkout: a new typed remote namespace requires adding it to a hardcoded build-time array in `packages/api/remotes/src/client/index.ts` — a DSH repo edit, which contradicts the out-of-tree decision **[ADR-002]**. Therefore:

| Route | Kind | Purpose |
|---|---|---|
| `GET/HEAD /video/media/<project>/<relpath>` | prefix, own handler | **Range-capable** media streaming (proxies, cache segments, stills, exports) for `<video>`/`<img>` |
| `POST /video/api/<method>` | prefix, own handler | unary commands: `project.open`, `edl.patch`, `note.add`, `review.submit`, `render.start`, `render.cancel`, `pane.state` |
| `GET /video/events?project=…&session=…` | prefix, own handler | **SSE** push: job progress, dirty-segment transitions, rev changes, lint findings |
| `ctx.connection.rpc.handle('/video', …)` | fallback | Documented alternative if HTTP+SSE proves awkward; contract-complete but unexercised in-tree |

Consequences we must implement ourselves, because registered routes sit **outside** DSH's `/api` trust fence:

1. **Loopback-only**: reject any request whose `Host` header is not `127.0.0.1`/`localhost`/`[::1]` and whose `sec-fetch-site` is `cross-site` — the same posture `isTrustedApiRequest` applies to `/api`.
2. **Path confinement**: resolve the requested path, `realpath` it, and require it to be inside the project root. Reject symlink escapes. No directory listing.
3. **Range correctness**: parse `Range: bytes=a-b` (single range only), answer `206` + `Content-Range` + `Accept-Ranges: bytes` + `Content-Length`; `416` on unsatisfiable; stream with `createReadStream({start,end})`. `HEAD` answers headers only. This is what makes scrubbing work at all.
4. **ETag/`Last-Modified`** from content hash + mtime so a re-rendered segment invalidates in the browser automatically.

The API envelope is a thin, self-describing shape — no codegen needed, and the same TS types are imported by both halves from `core/wire.ts`:

```ts
// core/wire.ts
export interface VideoRequest { method: string; projectId: string; sessionId: string; payload: JsonValue }
export type VideoResponse<T = JsonValue> =
  | { ok: true; value: T }
  | { ok: false; error: { code: VideoErrorCode; message: string; remediation?: string } }

export type VideoEvent =
  | { type: 'rev.changed'; rev: number }
  | { type: 'job.progress'; jobId: string; kind: 'analysis' | 'render'; phase: string; done: number; total: number; etaMs?: number }
  | { type: 'segment.state'; key: string; state: 'fresh' | 'stale' | 'rendering' | 'failed' }
  | { type: 'lint.report'; rev: number; findings: LintFinding[] }
  | { type: 'notes.changed'; rev: number }
```

### 5.5 Render pipeline

#### 5.5.1 Render tiers

Choosing the cheapest renderer that can produce a segment is the largest single performance decision in this design.

| Tier | Renderer | Covers | Cost proxy |
|---|---|---|---|
| **T0** | FFmpeg only: trim/`concat`/`scale`/`overlay`, captions burned via `libass` (ASS `\t` karaoke), audio buses | Cut-only segments; caption presets that are "static box + highlight"; zoom via `zoompan`/scale+crop; picture-in-picture B-roll at fixed geometry | ~0.1–0.3× realtime |
| **T1** | Chromium via HyperFrames: HTML composition per segment, frame-seeked, GSAP motion | Word-pop/stack/motion-blur typography, rotated B-roll clusters, full-screen animations, chart/lower-third graphics, cutout transitions | ~1.2–3× realtime ÷ workers |
| **T2** | Pre-baked assets (AI stills, generated B-roll, rendered lower-third PNG sequences) | Anything expensive that does not change per revision | Offline, once, cached by prompt+seed |

A preset declares its floor (`requires: 'ffmpeg' | 'chromium'`), and the segment compiler picks `max(tier of every op in the segment)`. Because a typical talking-head short is caption-heavy, **most of its segments should land in T0**, which is what makes the 60-second note round realistic.

#### 5.5.1b Measured renderer economics (gate S3, on the dev machine)

| Tier | Fixed cost per invocation | Marginal cost | 60 s render |
|---|---|---|---|
| **T0** FFmpeg/libass | ~0 s | ≈1.7 s per output second (1080×1920) | ≈100 s |
| **T1** Chromium/HTML | **≈13.6 s** | 3.2 s/s @540p · 5.9 s/s @1080p | 200 s (540p) – 370 s (1080p) |

Two design rules follow, and they are binding rather than advisory:

1. **Batch T1.** Because the fixed cost is paid per `hyperframes render` invocation, splitting a
   dirty region into many small Chromium segments multiplies cost. Contiguous dirty intervals are
   merged and rendered as one run; T1 segment granularity is coarse (≥8–12 s). The per-segment
   content-addressed cache remains exact for **T0**, where there is no fixed cost.
2. **T0 by default.** Every overlay that a preset can express as filters + libass stays in T0.
   Chromium is for motion-graphics bursts (word-pop typography, rotated clusters, full-screen
   animations), which is a minority of segments in a talking-head short.

Working-set numbers for a 60 s 9:16 short at preview quality: **T0-dominant ≈ 40–90 s**,
**T1-heavy ≈ 4–6 min**, incremental note round (1–2 dirty intervals, cached neighbours) ≈ **5–30 s**.

#### 5.5.2 The segment cache

```
render/cache/segments/<key[0:2]>/<key>/{seg.mp4, meta.json, frames/*.jpg?}
render/cache/assemblies/<assemblyKey>.mp4
```

```ts
function segmentKey(input: SegmentInput): string {
  return sha256(JSON.stringify([
    'seg-v1',                                  // cache format version — bump to invalidate
    input.profile.hash,                        // w,h,fps,codec,crf,preset,pixfmt
    input.renderer.tier, input.renderer.version,
    input.fontManifestHash,                    // fonts are a render input; hash the set
    input.clips.map(c => [c.srcSha256, c.mediaStartFrame, c.frameCount, c.speed]),
    input.ops.map(op => op.canonical).sort(),  // resolved ops, sorted, content-addressed
  ]).join('|'))
}
```

Segment boundaries are chosen, not fixed: `boundaries = snapToGop(union(dirtyIntervals, transitionSpans, sceneChanges), {minLen: 1.5s, maxLen: 12s})`. Every segment starts on a keyframe in the *proxy* (proxies are encoded with `-g 15 -keyint_min 15 -sc_threshold 0`, so a boundary is ≤0.5s away from any ideal point).

#### 5.5.3 Assembly

Segments encode with identical parameters and a closed GOP (`-x264-params "keyint=<n>:min-keyint=<n>:scenecut=0:open-gop=0"`, `-force_key_frames "expr:eq(n,0)"`), so the concat demuxer copies streams:

```sh
ffmpeg -f concat -safe 0 -i list.txt -c copy -movflags +faststart out.mp4
```

Rules that keep concat valid: identical codec/profile/level/pix_fmt/timebase; no B-pyramid mismatch; identical audio params (audio is muxed afterwards from the full mix, never per segment). **Transitions widen the dirty window**: a crossfade at boundary *k* makes both neighbouring segments dirty, because a transition is rendered inside a segment, not between them.

#### 5.5.4 Audio path

Audio is **never cached per segment**. It is cheap (no Chromium), and per-segment mixing creates seams and loudness mismatches. Per revision:

```
voice bus: concat(source audio slices) → gain/denoise/EQ → (optional) compress
music bus: file → gain automation → sidechain-duck by voice → fades
sfx bus:   one-shots placed at resolved frames
master:    sum → loudnorm(I=-14, TP=-1.0, LRA=11) → 48 kHz AAC 192k
```

The music-ducking rule from the transcript ("music 25 dB under my voice") is a *measured* rule, not a fixed gain: measure voice short-term RMS, set music to `voiceRMS - targetDeltaDb`, and clamp to `[-40, -8] dBFS`. The lint check `music-under-voice` then asserts the achieved delta, which closes the loop between intent and output.

#### 5.5.5 Determinism

Publish the contract in our own docs and enforce it in CI: fixed fps/width/height, integer frame math everywhere (`frameOf(ms) = Math.floor(ms * fps / 1000)`), no `Date.now`/`Math.random`/`requestAnimationFrame` in render paths, all assets resolved before capture, fonts loaded via local `@font-face` from the project (never a CDN), `--docker` or a pinned Chrome-for-Testing binary when cross-machine equality matters. `render/manifest` records the chrome version, hyperframes version, font manifest hash and ffmpeg build so a mismatch is *visible* rather than mysterious.

### 5.6 Preview strategy: four ladders to the same picture

| Ladder | Latency | Fidelity | When |
|---|---|---|---|
| **L0 — Live DOM composite** (pane) | 0 ms | Layout/typography/motion truth; not the final pixels | Every interaction: scrub, drag, retime |
| **L1 — Single frame render** | ~0.5–2 s | Real pixels (T0/T1) for one frame | "Does this actually look right?" button; drag release |
| **L2 — Window render** | ~5–20 s | Real pixels for a 2–10 s range | After a direct-manipulation commit; verifying a transition |
| **L3 — Full preview (540p)** | ≤3 min cold, ~concat when cached | The review artifact | Note rounds, sign-off |

L0 is why the pane feels like an editor; L3 is why the agent loop is cheap. L0 and T1 share code (§8.7): the pane renders the *same* DOM, the *same* CSS module and the *same* GSAP timelines that the Chromium renderer uses, so "it looked right in the pane" is a meaningful statement rather than a guess. The remaining fidelity gap (video scaling, colour, sharpness) is what L1/L2 exist to close.

### 5.7 Concurrency and job design

```
┌ render.start(preview) ─────────────────────────────────────────────┐
│ 1. resolve(edl) → dirty intervals → segment plan (list of keys)    │
│ 2. plan: hits / misses / est. wall time → returned to agent + pane │
│ 3. jobs.start({ kind:'render', run })  → segments into a pool      │
│    pool size = min(config.maxWorkers, cores-1, ceil(misses/2))     │
│    T0 segments:  cheap, up to 8 parallel ffmpeg                    │
│    T1 segments:  chromium, 1 process per worker, lazy-spawned       │
│ 4. each completed segment: write meta.json, SSE segment.state      │
│ 5. all done → audio mix → concat → preview.mp4 → manifest → rev    │
│ 6. job done → agent woken with a compact result digest              │
└─────────────────────────────────────────────────────────────────────┘
```

DSH facts this leans on: `ctx.jobs.start` preflight happens before `run()`; a `readOutput()` hook makes the job a "consuming stream job" so the pane and `job_output` both see progress; completion notification wakes a busy owner at its next step and an idle owner with a follow-up turn; `maxConcurrentJobsPerOwner` defaults to 10 — so a batch of 7 videos must cap per-project workers (§9.6). Render cancellation must kill child processes *and* leave completed segments intact (that is FR-27, and it is the same property that makes `--resume` cheap).

### 5.8 Security posture

- v1 binds loopback only; the pane is same-origin, so no CORS work.
- Media route reimplements the trust fence + path confinement (§5.4). No traversal, no absolute paths from the client, ever — the client sends `<projectId>/<relPath>` and the host resolves it.
- File mutations go through `ctx.fs` with the sandbox policy resolved exactly like `write` does, so `workspace-write` semantics (and the `sandbox_permissions` escalation shape) apply unchanged.
- Child processes (ffmpeg/chromium) are spawned through `ctx.subprocess`/`ctx.shell` so the sandbox and approval story is inherited rather than re-invented. If a deployment runs `read-only`, the product degrades to *review-only* (pane works, rendering is refused) — a deliberate, documented behaviour, not a bug.
- **Audio leaves the machine for transcription** (a deliberate v1 decision: hosted ASR is faster and better than CPU-only whisper on the target hardware, and the transcript is the one artifact every later step depends on). Provider, region and retention must be stated in the settings card, and the project record must show which provider produced each transcript.
- **Video frames never leave the machine unless vision QA is explicitly enabled**, and then only contact-sheet JPEGs of the user's own footage (§16-Q9). Renders, proxies, EDLs and notes are always local.

---

## 6. Data model

### 6.1 Project layout on disk

```
<workspace>/projects/<slug>/
  project.json                     # Project record (6.2)
  .lock                            # writer lock
  media/
    source/                        # references, not copies: path + sha256 recorded in project.json
    proxies/<srcId>/270p-intra.mp4 # scrub proxy: all-intra, tiny
    proxies/<srcId>/540p.mp4       # preview render input, CFR, GOP 15
    proxies/<srcId>/audio.wav      # 48k mono/stereo PCM
    assets/                        # imported B-roll / stills / sfx / music (content-addressed)
  analysis/
    transcript.<srcId>.json        # word-level (6.3)
    silence.<srcId>.json
    faces.<srcId>.jsonl
    beats.<srcId>.json
    speakers.<srcId>.json
  edit/
    edl.json                       # THE source of truth (6.4)
    revisions/<rev>.patch.json     # what changed, who, why (6.8)
  notes/
    notes.jsonl                    # append-only mirror of session events (6.5)
  style/
    skill.md                       # prose rules for the agent (project skill)
    rules.json                     # machine-checkable rules (6.6)
    presets/<presetId>.json        # typography / motion / layout presets
  render/
    cache/segments/…               # 5.5.2
    cache/assemblies/…
    stills/<key>.jpg
    preview/<rev>-540p.mp4
    final/<rev>-<profile>.mp4
    manifest/<rev>.json            # 6.7
  qa/
    reports/<rev>.json             # lint + vision findings
  exports/                         # delivery: mp4, srt, thumbnail, delivery.json
```

`project.json` is the only file the host rewrites under lock; everything else is append-only or content-addressed. That keeps crash recovery trivial: at worst you re-derive.

### 6.2 Project record

```ts
interface ProjectRecord {
  schemaVersion: 1
  id: string                       // 'prj_a1b2c3'
  name: string
  createdAt: string                // ISO
  sessionId: string                // owning DSH session
  sources: SourceAsset[]
  outputs: OutputTarget[]          // [9:16 1080x1920@30, 16:9 1920x1080@30, 1:1?]
  defaultOutputId: string
  style: { presetRef: string; rulesScope: 'project' }
  budget: Budget                   // §11.4
  ledger: Ledger                   // spend so far (tokens by model, render minutes)
  flags: { visionQA: boolean; cloudAssets: boolean; hardwareEncode: boolean }
}

interface SourceAsset {
  id: string                       // 'src-01'
  displayName: string
  path: string                     // absolute, or project-relative for copies
  sha256: string
  durationMs: number
  width: number; height: number; fps: number
  rotation: 0 | 90 | 180 | 270
  hasAudio: boolean
  analysis: { transcript?: string; silence?: string; faces?: string; beats?: string; speakers?: string }
  proxies: { scrub: string; preview: string; audio: string }
  analysisVersion: number          // bump to force re-analysis
}

interface OutputTarget {
  id: string                       // 'vertical'
  width: number; height: number; fps: number
  profileRef: 'preview-540p' | 'final-1080p' | 'final-4k'
  safeArea: { top: number; bottom: number; left: number; right: number }  // percent, per platform
}
```

### 6.3 Analysis artifacts

```ts
interface Transcript {
  srcId: string
  language: string
  model: string                    // 'elevenlabs-scribe-v1' | 'deepgram-nova-3' | 'local:distil-small.en'
  provider: 'api' | 'local'        // which side of the seam produced this transcript
  costUsd?: number                 // metered ASR spend for this source
  words: Word[]
  segments: { id: string; startMs: number; endMs: number; text: string; speaker?: string }[]
  text: string                     // convenience; never sent whole to the model
}

interface Word {
  id: string                       // 'w-00311' — stable per source, the anchor currency
  text: string                     // display text (punctuation stripped)
  raw: string                      // as transcribed, with punctuation/casing
  startMs: number                  // in SOURCE time
  endMs: number
  conf: number
  speaker?: string
}

interface FaceTrackRow { frameMs: number; boxes: { x: number; y: number; w: number; h: number; score: number; id: number }[] }
interface SilenceMap { srcId: string; regions: { startMs: number; endMs: number; kind: 'silence' | 'breath' | 'filler' }[] }
interface BeatGrid { srcId: string; bpm: number; beatsMs: number[]; downbeatsMs: number[] }
```

Word ids are the anchor currency: they are stable across re-transcription **as long as the source hash is unchanged**, and the resolver treats a missing id as a dangling anchor rather than renumbering silently.

### 6.4 EDL v1

```ts
interface Edl {
  schemaVersion: 1
  rev: number                      // monotonic; every accepted patch increments
  projectId: string
  fps: number                      // program fps (per output target resolution)
  clips: CutClip[]                 // ordered; the "cut list"; program order == array order
  text: TextClip[]
  visuals: VisualClip[]
  effects: EffectClip[]
  audio: AudioClip[]
  constraints: Constraint[]        // project-local hard rules layered over style/rules.json
  derivations: Derivation[]        // reels cut from this timeline (FR-17)
}

type Anchor =
  | { kind: 'time'; ms: number }                                   // escape hatch, discouraged
  | { kind: 'word'; word: string; offsetMs?: number }              // preferred
  | { kind: 'silence'; id: string; edge: 'start' | 'end'; offsetMs?: number }
  | { kind: 'beat'; index: number; offsetMs?: number }
  | { kind: 'clip'; clip: string; edge: 'start' | 'end'; offsetMs?: number }

interface Span { from: Anchor; to: Anchor; minMs?: number; maxMs?: number }

interface CutClip {
  id: string                       // 'c-07'
  src: string                      // source id
  in: Anchor                       // source-space anchor
  out: Anchor                      // source-space anchor, exclusive
  speed?: number                   // 1.0 default; 1.05..1.15 is the usual "tighten" range
  role: 'a-roll' | 'b-roll' | 'screen' | 'music-video'
  gainDb?: number
  transitionIn?: Transition        // rendered INSIDE this clip's leading frames
}

interface Transition { kind: 'crossfade' | 'dip' | 'whip' | 'slide'; durationMs: number }

interface TextClip {
  id: string                       // 't-12'
  kind: 'caption' | 'title' | 'lower-third' | 'statement' | 'stat' | 'label'
  during: Span
  words?: string[]                 // caption: word ids; timing derives per-word
  text?: string                    // authored text (title/statement/lower-third)
  preset: string                   // 'captions-bold-pop' etc.
  box: BoxHints
  group?: number                   // words per caption page (1..4)
  emphasis?: { word: string; style: 'accent' | 'scale' | 'underline' }[]
  overrides?: Record<string, JsonValue>   // human micro-edits; never mutates the resolver inputs
}

interface BoxHints {
  anchor: 'auto' | 'below-chin' | 'top-safe' | 'bottom-safe' | 'center' | 'beside-subject'
  dxPx?: number; dyPx?: number
  widthPct?: number                // undefined = fit content
  rotationDeg?: number
  avoid: ('faces' | 'title-safe' | 'other-text' | 'subject')[]
  align?: 'left' | 'center' | 'right'
}

interface VisualClip {
  id: string                       // 'v-04'
  kind: 'broll' | 'still' | 'screen' | 'composition' | 'cutout'
  during: Span
  source: { asset: string } | { src: string; in: Anchor; out?: Anchor }
  layout: 'fullscreen' | 'inset-tl' | 'inset-tr' | 'inset-bl' | 'inset-br' | 'split-top' | 'split-bottom' | 'cluster'
  box?: BoxHints
  motion?: string                  // motion preset id
  fit: 'cover' | 'contain'
  radiusPx?: number
  shadow?: boolean
  z: number
}

interface EffectClip {
  id: string
  kind: 'zoom' | 'shake' | 'color' | 'blur' | 'speed-ramp' | 'vignette'
  during: Span
  params: Record<string, JsonValue>   // zoom: { from: 1.0, to: 1.12, focus: 'face' | {x,y} }
}

interface AudioClip {
  id: string
  kind: 'music' | 'sfx' | 'room' | 'voice-treatment'
  during: Span                   // program space is allowed here; music has no word anchor
  source: { asset: string } | { src: string }
  gainDb?: number
  fadeInMs?: number; fadeOutMs?: number
  duck?: { by: 'voice'; targetDeltaDb: number }     // default { by:'voice', targetDeltaDb: 20 }
}

interface Constraint { id: string; rule: string; params: JsonValue; severity: 'block' | 'warn' }

interface Derivation {
  id: string                       // 'reel-01'
  kind: 'reel' | 'short' | 'clip'
  fromSpan: { startMs: number; endMs: number }   // program time of the parent timeline
  outputId: string                 // 'vertical'
  reframe: 'center' | 'follow-face' | 'split-subject'
  overrides?: { text?: TextClip[]; visuals?: VisualClip[]; hookText?: string }
}
```

**Why `Span.from/to` are anchors and not seconds:** this is the Hypit insight (§4.3). Retiming a word, removing a pause, or trimming a clip changes the program time of everything after it. With word anchors, every caption, B-roll cue and SFX follows automatically on the next resolve. With seconds, the agent has to recompute everything and silently gets it wrong.

### 6.5 Notes model

A note is a user-authored correction or intent, bound to program time and machine targets, and to the revision it was made against.

```ts
interface Note {
  id: string                       // 'n-0018'
  projectId: string
  rev: number                      // the EDL rev the user was reviewing
  tMs: number                      // program time of the playhead
  targets: NoteTarget[]            // resolved from the pane's hit-testing / user selection
  region?: { x: number; y: number; w: number; h: number }   // drawn box on the frame (normalized)
  text: string                     // what the user said, verbatim
  intent: 'fix' | 'style' | 'idea' | 'approve' | 'reject'
  status: 'open' | 'applied' | 'rejected' | 'superseded'
  appliedInRev?: number
  patchIds?: string[]              // which patches closed it
  author: 'user' | 'agent' | 'qa'
  createdAt: string
}

type NoteTarget =
  | { kind: 'clip'; clip: string }
  | { kind: 'text'; item: string; word?: string }
  | { kind: 'visual'; item: string }
  | { kind: 'audio'; item: string }
  | { kind: 'effect'; item: string }
  | { kind: 'timeline' }           // nothing specific: pacing, order, structure
```

Durability: notes are appended to the **DSH session log** as part of the review-submission message (so they participate in the agent's real context and are forkable), and mirrored to `notes/notes.jsonl` for the pane, for fast reload, and for `git diff` review. The mirror is a cache of the session log, never the other way round.

**Interface note on DSH:** out-of-tree plugins cannot extend `SessionEventMap`, so we do not invent a session event type. Two sanctioned mechanisms cover everything:
- **Pane → agent**: `host-server` resolves the session's live agent and calls `agent.followup({ content })` for a submission (durable user message, wakes/continues the turn) and `agent.steer(...)` only if we ever need mid-turn urgency. *(Signature to be confirmed in spike S1.)*
- **Agent → pane**: `ctx.jobs` progress + SSE; plus `agent.inject()` for durable context the agent wants the next request to see.

### 6.6 Style: prose skill + executable rules

`style/skill.md` is a normal DSH skill file — frontmatter plus prose — and it is the *agent's* reading material:

```markdown
---
name: video-editing-style-brand-x
description: Project style rules for <project>. Load before any edit, lint or render decision.
---

# Brand X reel style

## Cuts
- Remove every pause longer than 220 ms, every throat-clear, and every repeated take start.
- Target 1.0–1.4 word-cuts per second; never let a single clip exceed 9 s.

## Captions
- One line, max 4 words per page, bold condensed, sitting just under the chin
- Never cover the face; a caption may touch the top of the head, never the eyes
- Every caption must stay readable for at least 900 ms; start it 120 ms before the word if needed
- No captions during a full-screen animation

## Graphics
- B-roll insets: 38% width, slightly rotated (-4°..+4°), placed beside the subject's pointing side
- Music: 20–25 dB under the voice; duck under every spoken phrase
```

`style/rules.json` is the *same knowledge, machine-checkable*. Every rule is a stable id from the built-in catalogue with typed params; a rule that cannot be checked mechanically is a documentation-only entry and says so.

```json
{
  "schemaVersion": 1,
  "rules": [
    { "id": "caption-no-face-overlap", "severity": "block", "params": { "tolerancePx": 0 } },
    { "id": "caption-min-on-screen", "severity": "block", "params": { "minMs": 900, "leadInMs": 120 } },
    { "id": "caption-max-words", "severity": "warn", "params": { "words": 4, "lines": 1 } },
    { "id": "caption-none-on-fullscreen", "severity": "block", "params": {} },
    { "id": "broll-width-pct", "severity": "warn", "params": { "min": 30, "max": 45 } },
    { "id": "music-under-voice", "severity": "block", "params": { "targetDeltaDb": 20, "minDeltaDb": 18 } },
    { "id": "loudness-target", "severity": "block", "params": { "i": -14, "tp": -1.0 } },
    { "id": "max-clip-length", "severity": "warn", "params": { "ms": 9000 } }
  ]
}
```

Every id in that file maps to a **registered validator function** with a unit test (§8.5). The rule file is data; the checks are code; a rule id that has no validator fails loudly at load. This is the mechanism that makes "it never makes the same mistake again" true — the reference implementation relies on the model re-reading prose, which is probabilistic, and on a cheap model it is *not* reliable enough.

`style_learn` (FR-62) turns a note into a rule by matching it to a catalogue *template*, filling params, and then **replaying the current EDL against the new rule to show which existing captions would break**. The user (or agent) sees the blast radius before committing.

### 6.7 Render manifest and cache keys

```ts
interface RenderManifest {
  rev: number
  profileRef: string
  createdAt: string
  outputs: { path: string; sha256: string; bytes: number; durationMs: number }[]
  segments: { key: string; startFrame: number; endFrame: number; tier: 'T0' | 'T1' | 'T2'; hit: boolean; ms: number }[]
  audio: { key: string; voiceRmsDb: number; musicDeltaDb: number; loudness: { i: number; tp: number; lra: number } }
  environment: { chrome: string; hyperframes: string; ffmpeg: string; fonts: string; node: string; platform: string }
  stats: { totalMs: number; cacheHitRatio: number; dirtyIntervals: [number, number][] }
}
```

`stats.cacheHitRatio` and `dirtyIntervals` are not diagnostics — they are the **product's proof of promise** (D3). They are surfaced in the pane and returned to the agent so it can tell the user "12 of 30 segments reused; 18 seconds re-rendered".

### 6.8 Revisions, patches and undo

```ts
type EditOp =
  | { op: 'clip.trim'; id: string; in?: Anchor; out?: Anchor }
  | { op: 'clip.remove'; id: string }
  | { op: 'clip.insert'; after?: string; clip: CutClip }
  | { op: 'clip.reorder'; ids: string[] }
  | { op: 'text.add'; item: TextClip } | { op: 'text.setBox'; id: string; box: Partial<BoxHints> }
  | { op: 'text.retime'; id: string; during: Span } | { op: 'text.remove'; id: string }
  | { op: 'visual.add' | 'visual.setBox' | 'visual.retime' | 'visual.remove'; … }
  | { op: 'audio.add' | 'audio.gain' | 'audio.remove'; … }
  | { op: 'effect.add' | 'effect.remove'; … }
  | { op: 'rule.add' | 'rule.remove'; id: string }
  | { op: 'derivation.add' | 'derivation.remove'; … }

interface PatchResult {
  applied: boolean
  fromRev: number; toRev: number
  diff: ResolverDiff            // per-item before/after, plus dirty intervals
  notesClosed: string[]         // note ids this patch satisfies
  warnings: string[]            // e.g. "caption 't-12' now overlaps face bbox by 12 px"
}
```

Undo is "apply the inverse op list at the next rev" — the log is append-only, so history is `revisions/<rev>.patch.json` and a full replay is always possible. No in-place mutation of history.

---

## 7. The resolver contract and its invariants

The resolver is the product's centre of gravity: one pure function, ~600 lines, two consumers, two hard invariants.

```ts
// core/resolve.ts
interface ResolveInput {
  edl: Edl
  transcripts: Record<string, Transcript>
  faces: Record<string, FaceTrackRow[]>
  silence: Record<string, SilenceMap>
  beats: Record<string, BeatGrid>
  presets: PresetRegistry
  rules: RuleSet
  output: OutputTarget
  cacheHints?: { prev?: Resolved; segmentBoundaries?: number[] }
}

interface Resolved {
  rev: number
  output: OutputTarget
  durationFrames: number
  clips: ResolvedClip[]         // program-space, frame-exact
  items: ResolvedItem[]         // text/visual/effect: frames + solved pixel geometry
  audio: ResolvedAudio[]
  overlaysPerSegment: Map<string, number>   // cheap "can this be T0?" signal
  problems: ResolveProblem[]    // dangling anchors, impossible spans, rule violations
  dirty: Interval[]             // only when prev is supplied
}

function resolve(input: ResolveInput): Resolved
```

### 7.1 The projection step (borrowed from Hypit)

Resolution runs in five ordered passes; keeping them ordered is what makes re-flow predictable:

1. **Word index** — map `word.id → { srcId, srcStartMs, srcEndMs }`.
2. **Clip placement** — walk `edl.clips` in order, resolve each `in`/`out` anchor in *source* time to exact source frames, then place at `programStart = previousEnd - transitionOverlap`. Speed scaling applies: `programFrames = round(srcFrames / speed)`.
3. **Word → program frame projection** — for each clip, for each word whose midpoint falls inside `[in, out)`, compute `programFrame = clip.programStart + round((word.startMs - clip.inMs) / speed)`. Words outside every kept clip are **not** projected; an anchor referring to them becomes a dangling problem.
4. **Item placement and layout solve** — for each text/visual/effect: `startFrame = resolveAnchor(from)`, `endFrame = resolveAnchor(to)`, then apply span policy (`minMs`, lead-in, hang extension), then solve geometry through the layout solver (§8.3) which applies safe areas, face avoidance, other-text avoidance and authored hints/overrides *in that precedence order*.
5. **Lint hooks** — the resolver does not enforce rules, it only reports geometry; the rule engine (§8.5) runs on the `Resolved` value and produces findings. Kept separate so lint is testable without a renderer.

### 7.2 Invariant 1 — one resolver, two consumers

The `Resolved` value is computed by the same code in the host (renderer input) and in the browser (pane preview). Consequences that must be enforced in CI:

- `core` has no environment-dependent imports (no `node:fs`, no `window`), no `Date`, no `Math.random`.
- Golden test: for a corpus of EDLs, `JSON.stringify(resolve(...))` is compared against a committed snapshot, and the browser bundle's build output is checked to contain the same module (a smoke test that loads `core` in jsdom and compares the same snapshot).

### 7.3 Invariant 2 — dirty-interval minimality *(the headline guarantee)*

> **For any patch `P` applied to `edl` at revision `n`, and any note `N` whose only effect is `P`, the set of re-rendered segments must be contained in the segments covering `affectedSpan(P)` expanded by `transitionExpand` + `gopSnap`.**

This is testable as a property: for randomly generated patches over fixture projects, assert `renderedSegments ⊆ expectedSegments(P)`, with zero exceptions. It is the difference between "edit a piece of the video" as a marketing phrase and as an engineering guarantee. It is also the first thing to build a failing test for (day one of Phase 3).

Three corollaries the implementation must respect:

- **A patch that touches nothing visible renders nothing.** Setting an unused override, or adding a note, must produce `dirty: []` and no render.
- **Global changes are honestly global.** Changing a font, a preset default or a rule that alters geometry legitimately dirties every segment carrying that preset — and the pane must *say so* before rendering ("this will re-render 28 of 30 segments"), which is what a `plan` step is for.
- **Cache keys are complete.** Any render input not in the key is a silent correctness bug; the cache-key function is therefore co-located with the renderer's input struct, and a test asserts that mutating each field of the input changes the key.

---

## 8. Module specifications

Each subsection is a unit of work with a clear owner, a public surface, and its own tests. Files listed are the intended shape, not a constraint on naming.

### 8.1 `core` — schema, resolver, diff, layout

| | |
|---|---|
| Purpose | Everything that must be identical in the host and the browser |
| Depends on | nothing but `zod`-class validation (or hand-written guards) |
| Public API | `EdlSchema`, `resolve()`, `diffResolved()`, `applyOps()`, `computeDirty()`, `layout.solve()`, `digest()`, `wire.ts` |
| Files | `schema.ts`, `resolve.ts`, `diff.ts`, `ops.ts`, `layout.ts`, `digest.ts`, `wire.ts`, `rules/types.ts` |
| Tests | Schema round-trip; resolver golden snapshots; `diffResolved` property tests; cache-key completeness; digest ≤ N tokens for fixture projects |

Non-negotiable: `resolve()` is pure and allocation-bounded (no filesystem access, no font loading — font metrics come in as data). `digest()` produces the compact textual state the agent reads (§9.4) and is *the* contract for keeping cheap models cheap.

### 8.2 `presets` — the template library

A preset is a bundle of typography, layout policy, motion and tier requirement. It is the "20 templates" of the reference, expressed as data.

```ts
interface TextPreset {
  id: string                              // 'captions-bold-pop'
  kind: TextClip['kind']
  requires: 'ffmpeg' | 'chromium'
  typography: { fontFamily: string; fontWeight: number; sizePct: number; lineHeight: number; tracking: number; case: 'none'|'upper'; color: string; accent?: string; stroke?: { width: number; color: string }; shadow?: string }
  boxStyle: { bg?: string; paddingXPct: number; paddingYPct: number; radiusPx: number; taper?: boolean }
  layoutPolicy: { anchor: BoxHints['anchor']; maxLines: number; maxWords: number; safeAreaBias: number }
  motion: { in: MotionSpec; out: MotionSpec; perWord?: MotionSpec; emphasis?: MotionSpec }
  tier2Fallback?: { libassStyle: string }        // how to approximate at T0
  describe(): InspectorSchema                     // Studio Companion pattern (§4.4)
}

interface MotionSpec { preset: string; durationMs: number; easing: string; params?: Record<string, JsonValue> }
```

v1 ships **8 presets**, chosen to cover the reference's list rather than to be exhaustive: `captions-bold-pop`, `captions-fitted-line`, `captions-stack-karaoke`, `title-statement`, `lower-third-minimal`, `stat-callout`, `broll-inset-rotate`, `fullscreen-animation`. Each ships with a golden-frame fixture (§13.2) so typography regressions are caught as image diffs, not opinions.

### 8.3 Layout solver (the piece that makes "text never covers my face" real)

Input: box hints + safe areas + face tracks + already-placed items. Output: an exact pixel box, or a `layout-failed` problem when no legal placement exists.

```ts
interface LayoutRequest {
  item: ResolvedItem
  measure: (text: string, preset: TextPreset, widthPx: number) => { w: number; h: number; lines: number }
  faces: IntervaledBoxes          // face bboxes over the item's span
  occupied: PlacedBox[]           // other text/visual items active in the span
  safeArea: OutputTarget['safeArea']
  hints: BoxHints
}

function solveLayout(req: LayoutRequest): { box: PixelBox; rotationDeg: number; usedFallback: boolean } | { failure: 'no-legal-position'; reason: string }
```

Algorithm (deterministic, no model in the loop — this is why a cheap model can drive it):

1. Compute the candidate anchor line from the hint (`below-chin` = chin y of the *nearest* face + preset gap; `bottom-safe` = safe-area bottom − inset; `auto` = below-chin with a bottom-safe fallback).
2. Fit the text to the width policy; if it exceeds `maxWords`/`maxLines`, split pages on word boundaries (this is where the "hang" policy applies — extension happens in the resolver, not here).
3. Test the candidate box against: face boxes (zero overlap for `avoid: ['faces']`, measured in px²), other items (`avoid: ['other-text']`), title-safe.
4. On collision, try the ordered fallback ladder: (a) shift vertically in 8 px steps away from the face, (b) reduce width to the next preset breakpoint, (c) move to the opposite third, (d) shrink to `minScale` 0.85, (e) fail loudly.
5. Record `usedFallback` — a segment full of fallbacks is a *style* problem the agent should see in the digest.

Note the precedence order, which is a design decision worth stating: **rule violations win over aesthetic intent**. If the user drags a caption onto a face, the pane allows it (it is their video) but marks it as a rule violation, and `final` render is soft-blocked until acknowledged or the rule is relaxed. Silent correction is worse than visible objection.

### 8.4 `host-ingest` — analysis jobs

| Step | Command shape | Notes |
|---|---|---|
| probe | `ffprobe -v error -print_format json -show_streams -show_format` | Records rotation, VFR flag, colour space |
| proxy (scrub) | `ffmpeg -i src -vf scale=-2:270 -c:v libx264 -g 1 -crf 30 -an` | All-intra for instant seek; ~15–40 MB/min |
| proxy (preview) | `ffmpeg -i src -vf scale=-2:540,fps=30 -c:v libx264 -g 15 -keyint_min 15 -sc_threshold 0 -crf 21 -c:a aac` | Fixed GOP so segment boundaries snap cheaply |
| audio | `ffmpeg -i src -vn -ac 2 -ar 48000 -c:a pcm_s16le` | Mono extraction for transcription too |
| transcribe | **Hosted ASR through the `TranscriptionProvider` seam. Default: OpenAI `whisper-1`** — `POST /v1/audio/transcriptions` with `response_format=verbose_json` and `timestamp_granularities[]=word` + `[]=segment`. Extract 16 kHz mono WAV (mono; chunk at silence boundaries if over the 25 MB limit), one call per source, normalise `words[].word/start/end` into our `Word[]` with deterministic ids, cache by `(audioSha256, provider, model, granularity)`. **Word timestamps exist only on `whisper-1`, not on the `gpt-4o-transcribe` family — never "upgrade" the model without checking that.** Published price ≈ $0.006/min (~$0.36/hr), ~1.6× the reference's ElevenLabs figure: fine for the accuracy gain, confirm on the bill. `local:distil-small.en` stays as the no-key/offline fallback | Language autodetect (hint when known); segment texts kept for chapter/reel detection; provider + model + `costUsd` recorded on the transcript |
| silence | energy + VAD over the audio; classify `silence` / `breath` / `filler` | Feeds both cutting and caption hanging |
| faces | sample 3 fps, detect + track, smooth with a 5-frame median | Feeds safe zones and 9:16 reframe |
| beats | onset detection over music only | Optional in v1 |

Every step is keyed `(sourceSha256, step, toolVersion)` and skipped on rerun (FR-09). Each runs as a DSH job so a 20-minute source does not block the session; the tool returns after launching and the agent is woken on completion.

### 8.5 `host-style` + `host-qa` — rules and quality gates

```ts
interface RuleValidator {
  id: string
  severity: 'block' | 'warn'
  validate(resolved: Resolved, params: JsonValue, ctx: RuleContext): LintFinding[]
  proposeFix?(finding: LintFinding, resolved: Resolved): EditOp[]   // optional auto-repair
}

interface LintFinding {
  ruleId: string; severity: 'block' | 'warn'
  items: string[]                    // item ids
  spanFrames: [number, number]
  message: string                    // human- and model-readable
  measured?: Record<string, number>  // e.g. {overlapPx2: 1400}
  fixable: boolean
}
```

Built-in validators for v1 (FR-61): `caption-no-face-overlap`, `caption-min-on-screen`, `caption-max-words`, `caption-none-on-fullscreen`, `caption-lead-in`, `broll-width-pct`, `broll-max-duration`, `music-under-voice`, `loudness-target`, `max-clip-length`, `text-in-title-safe`, `no-two-items-same-z-overlap`, `asset-licence-ok`. Each gets fixtures: one passing, one failing, one boundary.

**Vision QA** (`host-qa/vision`): after a preview render, pick "risky" frames — every caption page change, every overlay in/out, every zoom mid-point, plus a uniform skeleton sample to a cap of ~20 frames — tile them into 1–3 contact sheets (JPEG, ~1600 px wide, labelled with frame indices), and ask the vision model for structured findings:

```json
{ "findings": [ { "frame": 214, "severity": "warn", "issue": "caption overlaps eye line", "suggest": "shift caption down 40px" } ], "overall": "acceptable" }
```

Guard rails: deterministic lint runs first and always (free, exact); vision is a second opinion, capped per project, and never blocks a render on its own. Cost is bounded because a contact sheet is one image per request.

### 8.6 `host-render` — the renderer seam

```ts
interface Renderer {
  id: 'ffmpeg' | 'chromium'
  version(): string
  supports(segment: SegmentPlan): boolean
  renderSegment(seg: SegmentPlan, out: string, signal: AbortSignal, onProgress: (p: number) => void): Promise<void>
}

interface SegmentPlan {
  key: string
  tier: 'T0' | 'T1'
  startFrame: number; endFrameExclusive: number
  clips: ResolvedClip[]
  ops: ResolvedItem[]                       // includes layout-solved geometry
  profile: RenderProfile
  assets: { path: string; sha256: string }[]
}

interface RenderProfile { id: string; width: number; height: number; fps: number; crf: number; preset: string; pixFmt: 'yuv420p'; gopFrames: number; audio: { rate: number; bitrate: string } }
```

Two drivers, one interface:

- **`ChromiumRenderer`** compiles `SegmentPlan` → a self-contained HTML composition (our own template, written to `render/cache/work/<key>/`), then drives HyperFrames' engine for exactly `[startFrame, endFrameExclusive)`. Two compilation modes are supported because HyperFrames' range semantics need verifying in the spike: `timebase: 'absolute'` (one composition, render a window — preferred) and `timebase: 'segment'` (per-segment composition with local t=0, offsets baked in — the fallback). The mode is a config flag, chosen after spike **S3**.
- **`FFmpegRenderer`** handles T0: concat/trim/crop/`zoompan`/`overlay`, with captions burned through an ASS file generated from the resolved caption items (booked as the T0 approximation of each preset).

**Segment worker pool** (`host-render/pool.ts`): bounded concurrency, separate ceilings for T0 (ffmpeg, cheap, default `min(8, cores)` — measured 14.2 s for four 6–7 s 1080p segments on an 8-thread Intel i7, so T0 is CPU-encode-bound and parallelises well) and T1 (Chromium, 1 browser per worker, memory-bound — default `min(2, floor(ramGB/3))`, i.e. **2 workers on the current 8 GB dev machine**, 6+ on a 32 GB Apple Silicon box; each browser ~256–400 MB). Progress from both drivers is normalised to frames and emitted as job output + SSE.

### 8.7 Shared preview renderer (`core/preview` + pane)

The pane must draw overlays the way the renderer will. Concretely:

- One CSS module per preset, imported by *both* the Chromium composition generator (which inlines the CSS file) and the pane (which imports it through the client bundle).
- One motion definition per preset: a `MotionSpec` compiles to a GSAP timeline. The pane uses GSAP directly; the Chromium composition embeds the same GSAP call in a `window.__timelines[id]` factory. A preset therefore cannot drift between preview and render without breaking its own golden test.
- Fonts are resolved by the same font manifest and loaded from the project on both sides (no CDN, ever — that would break determinism and offline use).

This shared-code requirement is a hard architectural constraint. It is also what allows the "L0 live composite" (§5.6) to be trusted enough that the user does not need a render to judge placement.

### 8.8 `host-server` — routes, media, events

| Method | Path | Behaviour |
|---|---|---|
| `GET/HEAD` | `/video/media/<projectId>/<rel>` | Range-capable static serving of anything under the project's `media/`, `render/`, `qa/`, `exports/`; ETag from content hash; 404 outside confinement |
| `POST` | `/video/api/project.open` | Resolve or create a project for a source path; return `ProjectRecord` + current `Resolved` summary |
| `POST` | `/video/api/pane.state` | Everything the pane needs in one round-trip: `ProjectRecord`, `Resolved` (items + clips + problems), latest lint, segment states, notes page, latest manifest |
| `POST` | `/video/api/edl.patch` | User-originated geometry patches from direct manipulation (box moves, retimes) — validated, applied at a new rev, notes attached |
| `POST` | `/video/api/note.add` / `note.update` | Note CRUD; append-only mirror; SSE `notes.changed` |
| `POST` | `/video/api/review.submit` | Batch of open notes → `agent.followup()` with the structured block (§9.5) |
| `POST` | `/video/api/render.start` / `render.cancel` | Start a scoped render job; returns the **plan** first (hits/misses/eta) when `dryRun: true` |
| `GET` | `/video/events` | SSE: `job.progress`, `segment.state`, `rev.changed`, `lint.report`, `notes.changed` |

SSE rather than polling because the pane must feel live during a render (30 segments × ~2s each is 30 events a minute) and because it is the same pattern DSH already uses for HMR. One connection per pane; heartbeats every 15 s; resumable via `Last-Event-ID`.

### 8.9 `host-tools` — the model-facing surface

Ten tools, each idempotent, each cheap to describe (see §9). This package owns argument validation, workspace/sandbox policy resolution, job orchestration and the digest rendering — nothing else. All heavy lifting is delegated to the packages above so the tools stay thin enough to test with fakes.

### 8.10 `skill` — `video-editing`

A DSH skill bundle shipped as package resources and installed to `~/.dsh/skills/video-editing/` (or referenced per-project at `<git-root>/.dsh/skills/video-editing/`). Contents:

```
SKILL.md                  # frontmatter + the work loop + the rules of engagement
references/edl.md         # the EDL schema in model-readable form, with examples
references/anchors.md     # how to anchor time; dangling-anchor repair procedure
references/workflow.md    # the 11-stage pipeline, with the tool for each stage
references/presets.md     # the 8 presets and when to choose each
references/review.md      # how to read notes, batch them, close them, promote to rules
references/troubleshooting.md
```

`SKILL.md` frontmatter is exactly what DSH expects (`name`, `description`, optional `whenToUse`), because the loader validates kebab-case names and the presence of both fields, and logs+skips anything malformed.

---

## 9. Model-facing contracts: tools, commands, skill

### 9.1 Design rules for a cheap model

The brief's constraint ("their cheaper model") is an architecture constraint, not a pricing footnote. Five rules follow from it:

1. **≤10 tools, ≤600 tokens of total tool-schema.** Every extra tool and every verbose description taxes every request in the session.
2. **Digests, never dumps.** No tool ever returns a full EDL, a full transcript, or a full frame list. The digest is a compact, *complete-enough* text rendering (§9.4).
3. **Deterministic geometry beats model geometry.** The model chooses *intent* ("caption below chin, avoid faces"); the solver computes pixels. Models are bad at arithmetic and cheap models are worse.
4. **Idempotent, resumable steps.** Every tool call can be retried and re-called; nothing depends on hidden in-tool state.
5. **Failures are instructive.** Errors carry `code`, `message`, and a `remediation` string that tells the model what to do next ("anchor 'w-00311' no longer exists; call video_edl_read with `problems` and re-anchor to a neighbouring word id, or switch the span to a time anchor"). Cheap models recover from structured errors and flounder on stack traces.

### 9.2 The tool table

| Tool | Purpose | Scope | Mutates |
|---|---|---|---|
| `video_project` | open / status / list / close a project; returns digest + budget | project | project record |
| `video_analyze` | run or re-run ingest steps (probe, proxies, transcript, faces, silence) idempotently; returns a job or a summary | project | media + analysis |
| `video_edl_read` | **the digest**: clips, overlays, problems, dirty segments, notes count, last render | project | no |
| `video_edl_patch` | apply typed ops, `dryRun` returns the diff + estimated dirty segments | plan | `edl.json` |
| `video_render` | scoped render: `stills` / `segment` / `preview` / `final`; `dryRun` returns the plan (hits, misses, eta, est. minutes) | range | render cache |
| `video_frames` | return N stills (or one contact sheet) at given program times as file paths the vision model can read | range | no |
| `video_notes` | list/claim/close notes; group them; mark applied with patch ids | project | notes |
| `video_lint` | run deterministic rules + optional vision QA; return findings with fix proposals | project | qa reports |
| `video_style_learn` | turn a note or statement into rule(s); preview blast radius on the current EDL | project/global | `style/` |
| `video_deliver` | final render + SRT + thumbnail + `delivery.json`; optional upload | project | exports |

### 9.3 Two tools in full

```ts
// host-tools/src/edl-patch.ts
ctx.tools.register(defineTool({
  name: 'video_edl_patch',
  description:
    'Apply edit operations to a project. Always call with dryRun:true first when you are unsure. ' +
    'Returns the resolver diff, the segments that will re-render, and which notes the patch closes.',
  parameters: {
    projectId: { type: 'string', required: true, description: 'Project id, e.g. prj_a1b2c3' },
    ops: {
      type: 'array', required: true,
      description: 'Edit operations. See references/edl.md. Order matters; application is atomic.',
      items: { type: 'object' },
    },
    noteIds: { type: 'array', description: 'Notes this patch intends to satisfy', items: { type: 'string' } },
    dryRun: { type: 'boolean', description: 'Compute the diff without committing (default false)' },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        applied: { type: 'boolean' }, fromRev: { type: 'number' }, toRev: { type: 'number' },
        dirtySeconds: { type: 'number' }, dirtySegments: { type: 'number' },
        summary: { type: 'string' }, problems: { type: 'array', items: { type: 'string' } },
      },
    },
    render: (_args, v) => [{ type: 'text', text: v.summary }],
    presentationMeta: (_args, v) => ({ kind: 'edit', files: ['edit/edl.json'], rev: v.toRev }),
  },
  timeoutMs: 20_000,
  isConcurrencySafe: () => false,
  async execute(args, exec) {
    return edlPatch(args, exec)      // resolves sandbox policy internally, like write does
  },
}))
```

```ts
// host-tools/src/render.ts
ctx.tools.register(defineTool({
  name: 'video_render',
  description:
    'Render a scope of the timeline. dryRun returns the plan (cache hits, segments to render, estimated ' +
    'minutes) without spending compute. preview=540p for review, final=output profile for delivery.',
  parameters: {
    projectId: { type: 'string', required: true },
    scope: { type: 'string', required: true, enum: ['stills', 'segment', 'preview', 'final'] },
    outputId: { type: 'string', description: 'Output target, e.g. vertical' },
    range: { type: 'object', description: '{ startMs, endMs } for segment/stills' },
    times: { type: 'array', description: 'Program times for stills', items: { type: 'number' } },
    dryRun: { type: 'boolean' },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' }, planned: { type: 'boolean' },
        cacheHits: { type: 'number' }, toRender: { type: 'number' },
        etaSeconds: { type: 'number' }, outputPath: { type: 'string' }, note: { type: 'string' },
      },
    },
    render: (_a, v) => [{ type: 'text', text: v.note }],
  },
  isConcurrencySafe: () => true,
  async execute(args, exec) {
    return renderTool(args, exec)    // jobs.start(...) → { jobId } or a plan
  },
}))
```

The eight remaining tools follow the same shape; their full signatures live in `references/edl.md` and `references/workflow.md` so the *skill* documents them without inflating the tool schemas.

### 9.4 The digest format (why the model stays cheap)

`video_edl_read` returns this, not JSON:

```text
PROJECT prj_a1b2c3 · "Ep 41 — cold email" · source src-01 (4m12s, 1080p30)
REV 12 · OUT vertical 1080x1920@30 · 47.4s · 1421 frames · rendered 2m04s ago
CLIPS 18 (avg 2.6s): c-01 0.0-3.1 · c-02 3.1-6.4 · c-03 6.4-11.9 spd1.05 · … · c-18 44.9-47.4
TEXT 31 caption pages, preset captions-bold-pop, group 3, 0 face collisions, 2 fallback placements
  t-112 18.42-19.60 "so the whole point" · t-113 19.60-20.85 "is that you" · …
VISUALS 4: v-01 inset-tr 14.2-17.0 broll-laptop · v-02 fullscreen 27.0-29.4 template-cold-email · …
EFFECTS 2: e-01 zoom 22.0-24.0 ×1.12 focus=face · e-02 zoom 33.1-35.0 ×1.08 focus=face
AUDIO 3: music-bed 0-47.4 -21dB duckΔ20 · sfx-01 whoosh@18.2 -18dB · sfx-02 pop@30.1 -14dB
PROBLEMS 0
DIRTY none · 30/30 segments fresh · budget left: 420k tokens, 38 render-min
```

~330 tokens for a complete, actionable picture of a 47-second edit. Compare with the raw EDL (~6–9k tokens) — and note the digest deliberately omits word text, which the agent fetches only for the range it is editing (`video_edl_read --range 18s-21s --withWords`).

### 9.5 The review submission block

When the user clicks **Send notes**, `host-server` builds one message and calls `agent.followup()`. The message is plain text with a structured block — no attachment machinery, no new event type, maximally legible to a cheap model:

```text
Please apply these review notes to project prj_a1b2c3 (Rev 12).

<video_review project="prj_a1b2c3" rev="12" output="vertical" digest="…">
<note id="n-0018" at="14.20s" intent="fix" targets="visual:v-01">
  the b-roll should be smaller and sit where my finger is pointing, above my head. slightly rotated is fine,
  it can touch the top of my head, just don't cover my eyes.
</note>
<note id="n-0019" at="27.00s" intent="style" targets="text:t-118 visual:v-02">
  when you do full-screen animations like this, don't add captions to them.
</note>
<note id="n-0020" at="39.10s" intent="fix" targets="text:t-124">
  the big font doesn't stay on screen long enough. add a hang so I can read it.
</note>
</video_review>

After applying: run video_lint, then video_render scope=preview dryRun=true and report the plan.
Propose any note that should become a style rule.
```

The agent's expected loop is spelled out in the skill, so it does not depend on the model improvising: `video_edl_read` → `video_edl_patch(dryRun)` → `video_edl_patch` → `video_lint` → `video_render(preview, dryRun)` → `video_render(preview)` → report. Six tool calls, no more.

### 9.6 Batch protocol (FR-73)

For N sources under one style, the parent agent:

1. Calls `video_project` N times (fast, no model reasoning) to create N projects.
2. Spawns N subagents with `toolFilter: { allow: ['video_*'] }`, `agentOptions.model = 'deepseek-v4-flash'`, each given the *same* style digest and its own `projectId`.
3. Caps concurrency to respect `maxConcurrentJobsPerOwner` (10) and the render pool: **N ≤ 4 videos in flight** by default, because each video's preview render wants 4–6 Chromium workers.
4. Collects a per-project structured result (rev, duration, findings count, output path) and reports one table.

The parent plans with `deepseek-v4-pro`; children execute with `flash`. Subagent depth caps at 3 by default in DSH, so children must not spawn grandchildren — the skill says so explicitly.

### 9.7 Slash commands (FR-82)

| Command | Behaviour |
|---|---|
| `/video <path?>` | Open or create a project for the current session; print the digest |
| `/render <scope> [dry]` | Render directly from the command handler (no model turn — `ctx.commands` handlers are not model-facing) |
| `/notes` | Print the open-note summary as a command result |
| `/style` | Print the active rules and the presets in force |

Commands are a deliberate escape hatch: UI-fast operations should not cost a model turn.

---

## 10. The Studio pane (UI specification)

### 10.1 Registration and layout

Registered into `conversation.view` (a list slot, session-scoped) as a sibling of the built-in Chat view:

```ts
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'studio',
  order: 20,
  locale: NS,
  label: () => t('view.studio'),          // thunk: follows locale switches
  inject: (sessionId) => ({ sessionId, projectStore, connection }),
}, StudioView))
```

Layout (desktop, ≥1280 px):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Chat] [Studio]                            rev 12 · vertical · 0:14 / 0:47   │  header
├───────────────────────────────────────────┬──────────────────────────────────┤
│                                           │  NOTES (7 open)   [Send to agent]│
│              ┌───────────────┐            │  ────────────────────────────────│
│              │               │            │  ● 0:14  fix   v-01              │
│              │   <video>     │            │    "b-roll smaller, above head"  │
│              │  + overlays   │            │  ● 0:27  style t-118            │
│              │  (DOM, GSAP)  │            │    "no captions on fullscreen"   │
│              └───────────────┘            │  ○ 0:39  fix   t-124            │
│   [⏮][▶][⏭] 0:14.20 / 0:47.40  [1×]       │    "add hang so I can read it"   │
│   [ Render changed (3) ] [ Render window ]│  ────────────────────────────────│
├───────────────────────────────────────────┤  INSPECTOR                       │
│ ruler  0     10     20     30     40      │  preset  captions-bold-pop  ▾    │
│ text   ▓▓▒▒▓▓▒▒▓▓▒▒▓▓  (stale segments ▒) │  anchor  below-chin         ▾    │
│ visual     ░░██░░   ██░░░                 │  avoid   ☑ faces ☑ title-safe    │
│ audio  ███████████████████████████████    │  words   ● ● ○ ○                 │
│ notes  ·    ●        ●        ●           │  z 40  15° rotation              │
└───────────────────────────────────────────┴──────────────────────────────────┘
```

Below 1024 px the notes rail collapses into a drawer; the viewer keeps 16:9/9:16 letterboxing based on `output.width/height`.

### 10.2 Time and rendering model in the pane

- **Playback** is driven by the scrub proxy (`/video/media/<prj>/media/proxies/src-01/270p-intra.mp4`), seeked by `currentTime` when the playhead crosses into a different clip. Cuts are honoured by seeking to `(programTime - clipStart) * speed + clipInMs` — the pane runs the same clip-placement math as the resolver, so it needs no second implementation.
- **Overlays** are absolutely positioned DOM nodes inside a fixed-aspect stage, sized from the resolved pixel geometry scaled by `stagePx / output.width`. Text is real text (same CSS module, same font, same weight), so wrapping and truncation are truthful.
- **Motion** runs on the same GSAP timelines as the renderer, seeked (never played) on a single `gsap.timeline().seek(t)` per frame, driven by `requestVideoFrameCallback` where available and `rAF` otherwise.
- **Segment state** shades the timeline: `fresh` (solid), `stale` (hatched), `rendering` (pulse), `failed` (red). This is the visual answer to "can I edit a piece before the final render?" — the user literally sees which pieces are already rendered.
- **Perf budget**: overlay updates ≤4 ms per frame at 1080p-width stage; degradation ladder = skip motion at <30 fps, then degrade to position-only, then to a static frame.

### 10.3 Notes UX

- **Add**: `n` or the "Add note" button, at the playhead. If an item is selected or was clicked, the note binds to it; if the user drew a box, the region is attached; otherwise it binds to `timeline` scope.
- **Voice**: the pane exposes a mic button that sends a short clip to the same `TranscriptionProvider` seam (a 10 s note costs ~$0.0006) and drops the text into the note body — this is the reference's "Whisper Flow" habit, and it matters, because the notes are conversational.
- **Triage**: notes list groups by intent and by target; "open / applied / rejected" filters; applied notes show *which rev* closed them (provenance, §6.5).
- **Send**: submits all open notes in one batch (never one message per note — that multiplies model cost by 7). Disabled while a render is running, with the reason shown.
- **Promote**: a note tagged twice with the same shape triggers a "make this a rule?" chip.

### 10.4 Direct manipulation protocol

1. User drags a caption box → the pane mutates its **local** overlay transform only (no round-trip; zero latency).
2. On pointer-up: the pane POSTs `edl.patch` with `text.setBox { dxPx, dyPx }` (relative, not absolute — relative survives a resolver re-layout) and `noteIds` if the user was dragging under an open note.
3. The host applies the patch at a new rev, returns the solver's *adjusted* box (the solver may refuse illegal placement), the pane reconciles to the authoritative geometry and highlights segments that went stale.
4. The pane offers "Verify this frame" → `video_render scope=stills` → replaces the DOM composite with the real frame in a compare swipe.

Relative deltas are a deliberate choice: an absolute pixel position is invalidated by any re-flow (a caption that moves 3 words later must still be 40 px left of its new solved position).

### 10.5 Accessibility and platform

Focus-visible everywhere, `prefers-reduced-motion` disables decorative motion (never disables the *content* motion of the video itself — it seeks instead of animating), colour never carries meaning alone (segment states use pattern + label), and every interaction has a keyboard path. Styling follows DSH house rules: CSS Modules + `clsx`, semantic `--dsw-alias-*` tokens, no Tailwind, no component library.

---

## 11. Model routing, tokens and cost

### 11.1 Model tiering

| Role | Model | Why |
|---|---|---|
| Structural planning (hook selection, chapter structure, template choice, batch decomposition) | `deepseek-v4-pro` | Few calls, high leverage; errors here are expensive |
| Cut planning, caption grouping, B-roll selection, note application, rule authoring | `deepseek-v4-flash` | The 80% mechanical workload; digest-first design keeps it inside a small context |
| Frame QA on contact sheets | `deepseek-v4-flash-vision-exp` | Cheap visual self-check; 1 request covers ~20 frames |
| Batch children | `deepseek-v4-flash` | Fan-out must be cheap |

Reasoning effort: `high` for planning, `off`/`low` for mechanical loops (the resolver and validators do the thinking), which cuts output tokens substantially.

### 11.2 Token budget per video (estimates, to be validated in Phase 2 with the token meter)

| Stage | Calls | in (tokens) | out | Notes |
|---|---|---|---|---|
| Plan hook + structure (pro) | 1–2 | 6–12k | 0.8–1.5k | Transcript sampled, not full |
| Cut plan (flash) | 1–3 | 8–20k | 1–2k | Works on silence map + transcript words |
| Caption grouping + preset choice (flash) | 0–1 | 2–4k | 0.5–1k | Often zero: deterministic grouping is good enough |
| B-roll selection (flash) | 1–2 | 4–10k | 0.6–1.5k | Library digest, not file list |
| Note round (flash) | 1 | 4–8k | 0.8–2k | Per round; 1–2 rounds typical |
| Vision QA (vision) | 1–2 | 3–6k | 0.3–0.8k | 1–3 contact sheets |
| **Total per 60s short** | **5–11** | **~30–60k** | **~4–9k** | |

Long-form (14 min → 3 reels): ~180–400k in, ~25–60k out, spread across a planning call plus 3 child derivations, with transcript chunking per chapter so no single request carries the whole transcript.

### 11.3 Cost formula and the honest caveat

```
cost_video = Σ_stages (in_tokens × p_in(model) + out_tokens × p_out(model))   # LLM
           + asr_minutes × p_asr                                              # hosted transcription, per source
           + render_minutes × p_compute                                       # local: electricity, not money
```

**ASR is metered per minute** (OpenAI `whisper-1` ≈ $0.006/min → a 14-minute source ≈ $0.08, negligible next to one review round). **LLM pricing must be filled in from the current DeepSeek price sheet before Phase 2 sign-off.** Do not estimate vendor pricing from memory in an engineering document; the ledger table in `project.json` records *measured* tokens per model, so the first week of real use produces the grounded numbers, and §11.4's guard is written against measured, not assumed, cost.

### 11.4 Budget guard (FR-08, FR-84)

```ts
interface Budget {
  maxTokensPerVideo: number          // default 250_000
  maxVisionCalls: number             // default 6
  maxRenderMinutes: number           // default 45
  maxWallMinutes: number             // default 90
  onExceed: 'stop' | 'ask'           // default 'ask' (DSH approval answers it)
}
```

Enforced in `tools/pre-execute` on the video tools plus inside the render pool: exceeding a budget returns a structured refusal with the measured ledger and the three cheapest options to continue ("render only dirty segments — 3 min", "drop vision QA — ~4k tokens", "raise the budget"). The ledger is surfaced in the digest, so the agent knows how much room it has before it plans anything ambitious.

---

## 12. Delivery plan

> **Superseded for execution.** This section is the team-facing roadmap and scope thinking. The operative, step-by-step, agent-executable plan (with verification commands, gates and blockers) is [`build-plan.md`](./build-plan.md); live status is [`build-state.md`](./build-state.md). Kept here because the scope ladder and phasing rationale are still the reference for "what ships when".

### 12.1 Phase 0 — spikes (days 1–3, before any structure is committed)

Five unknowns can invalidate parts of this design. Each is a timeboxed, throwaway experiment with a written go/no-go.

> **Already de-risked before Phase 0:** the segment-cache mechanism itself was measured end to end on the current dev machine (`../proofs/segment-cache/build.mjs`, results in [`reverse-engineered-blueprint.md`](./reverse-engineered-blueprint.md) §11): four segments over a 24 s 1080×1920 program, ASS captions burned, one caption note applied to one segment → **14.2 s cold vs 4.2 s incremental (3.37×)**, untouched segments byte-identical. ADR-005 is therefore evidence-backed, not assumed. What remains unproven is the Chromium tier and the pane (S2, S3).

| # | Spike | Question | If it fails |
|---|---|---|---|
| **S1** | `agent.followup` from a host plugin | Can a plugin resolve a session's live agent and append a durable user message that starts a turn? | Fall back to `agent.steer`/injecting context and let the user press Enter in the chat view (acceptable: one extra click) |
| **S2** | Out-of-tree client bundle | Can a package built outside the DSH repo satisfy the `window.__ModuleLoader__.load({id, factory})` contract, register into `conversation.view`, and boot under `dsh --profile <p> web` with `pnpm run dev:web` HMR? | **Highest risk in the project.** Fallbacks in order: (a) accept an in-tree contribution for the pane package only; (b) prototype the pane as a `cordis_define` dynamic package (dev-only, no persistence); (c) serve a standalone local page from our `/video` route in an iframe (degraded integration, keeps the product viable) |
| **S3** | HyperFrames range semantics + determinism | Does a window render (`--start/--end` or the engine API) seek on the *absolute* composition timeline? Is output byte-identical across two runs with fonts pinned? | Use the `timebase: 'segment'` compile mode (per-segment compositions, offsets baked) — already designed for (§8.6); determinism fallback is `--docker` pinning or Ssim-threshold equality instead of hashes |
| **S4** | Range media route + scrub feel | Does `/video/media/...` with `206` + an all-intra 270p proxy give <120 ms seeks and smooth overlay compositing in Chrome/Safari? | Tighten the proxy (smaller, more keyframes), or preload a window buffer per clip, or fall back to WebCodecs for scrubbing |
| **S5** | ASR provider seam | One adapter against the chosen provider returns word-level timestamps that are monotonic, complete (no dropped words across pauses), and good enough to build captions from — verified on 3 real clips including one with background music. Provider choice confirmed (§16-Q15) | Add the local adapter as default and accept the accuracy/speed hit; the rest of the pipeline is provider-agnostic by design |

Exit criterion: all five answered in `spikes.md`, with a decision recorded in §15. **No production code before S2 and S3 have answers**, because both reshape the plan.

### 12.2 Scope ladder (one developer)

You selected all four content formats, direct manipulation, style learning and AI assets, with one dev and "as fast as possible". That is not one release. The ladder below is the honest sequencing; each rung is independently usable.

| Rung | Weeks | Delivers | Demos | What you can do at the end |
|---|---|---|---|---|
| **MVP** | 1–4 | Vertical talking-head short: ingest → cut → captions → preview → pane review → notes → segment re-render | D1, D2, D3 | Replace the reference workflow end to end for shorts |
| **v1.0** | 5–8 | Direct manipulation + lint/style rules + vision QA + reels-from-long-form + delivery | D4, D5, D6, D7 | Run the full director's loop on shorts and YouTube |
| **v1.1** | 9–12 | Long-form 16:9 chaptering, screen-recording/split-screen layouts, batch fan-out, AI assets, podcast/multi-cam | — | A production system for a whole channel |
| **v2** | later | Team/cloud deployment, share links, uploads, 4K | — | Product, not tool |

**Recommendation:** commit to MVP + v1.0 (8 weeks) and treat v1.1 as the next planning cycle. If you want everything in one push, plan for 12 weeks and expect the last three to be where quality work (typography, edge cases, audio polish) is compressed — which is exactly where this product's perceived quality lives.

### 12.3 MVP detail (weeks 1–4)

| Week | Work | Exit criteria |
|---|---|---|
| **1** | Spikes S1–S5. Then: workspace skeleton, bundle package + patch layer, `core` schema + resolver with word projection, ingest jobs (probe/proxy/audio/transcribe/faces/silence), fixture project committed | A fixture source is transcribed by the hosted provider and cached; `resolve()` produces correct clip placement and word→program projection on that fixture; `dsh --profile studio web` boots with our layer |
| **2** | EDL ops + patch/diff + digest, T0 renderer (FFmpeg concat/crop/ASS captions), T1 renderer (HyperFrames segment composition), preview render of a whole timeline, `video_analyze` + `video_edl_*` + `video_render` tools | **D1**: an agent turns a raw clip into a 45s captioned vertical with one zoom, one B-roll and music, from the chat view alone |
| **3** | Segment cache + dirty-interval computation + assembly + manifest; `host-server` (media route with Range, `pane.state`, SSE); pane v1 (viewer, timeline with segment states, notes rail, Send notes) | **D2** and **D3**: five notes → ≤60s round → visible `cached` vs `re-rendered` split in the timeline |
| **4** | Direct manipulation (drag/resize/rotate → relative patch), stills render + verify-frame, deterministic lint basics (face overlap, on-screen time, caption over fullscreen), golden-frame test harness | **MVP sign-off**: D1–D3 stable across 5 real videos of yours, D4 works for captions and B-roll insets |

### 12.4 v1.0 detail (weeks 5–8)

| Week | Work | Exit criteria |
|---|---|---|
| **5** | Full rule catalogue + validators + fix proposals; `video_style_learn` with blast-radius preview; skill bundles; promote-note-to-rule | D5: a rule learned on project A catches a violation in project B automatically |
| **6** | Vision QA contact sheets + findings overlay in the pane; rule `block` gate on final render | A planted caption-over-face is caught without the user spotting it |
| **7** | Derivations (reel from program window), reframe via face tracks (center / follow-face / split-subject), per-derivation overrides | D6: 14-minute source → 3 vertical reels with hooks, each independently reviewable |
| **8** | Delivery (1080p final, SRT/VTT, thumbnail, poster, `delivery.json`), manifest surfacing, `/render` and `/notes` commands, docs | D7: approve → final MP4 + assets in `exports/`, with provenance |

### 12.5 Team size note

At 2–3 devs the work splits cleanly along this line: **dev A** owns `core` + `host-render` (the correctness and performance core), **dev B** owns `host-server` + `client-pane` (the review surface), **dev C** owns `host-ingest` + `host-style` + `host-qa` (analysis and taste). The MVP stays 3–4 weeks; the ladder compresses to ~7 weeks. The interface between A and B is `core/wire.ts` + the SSE event union, and it should be frozen in week 1.

---

## 13. Test strategy

### 13.1 The pyramid

| Layer | What | Tooling | Gate |
|---|---|---|---|
| Unit | `resolve`, `applyOps`, `diffResolved`, layout solver, every rule validator, segment-key derivation, digest formatting | vitest | 100% line coverage on `core`; mutation testing on `diffResolved` |
| Property | **Dirty-interval minimality** (§7.3); cache-key completeness; patch round-trip (`apply(invert(p)) == identity`); anchor resolution determinism | fast-check-class generators over fixture projects | Zero counterexamples in CI, 500 cases per property |
| Golden frames | Preset + renderer output compared to committed PNGs | SSIM ≥ 0.995 (T0), ≥ 0.99 (T1); fonts pinned by manifest | Blocks merge on regression |
| Integration | Fixture project → preview render → assert manifest contents, segment hit ratio, loudness | vitest + real ffmpeg | Runs in CI on Linux; nightly on mac arm64 |
| Pane | jsdom component tests + slot registration/disposal (HMR safety: dispose the contributing fiber, assert cleanup) | `pnpm test:gui` style local suite | No leaked registrations, no store mirrors |
| Determinism | Render the same fixture twice, compare `sha256` | CI job | Byte equality on the reference machine |
| Agent loop | Scripted dry-run sequences of the six-call loop; digest token-count regression (assert ≤ 400 tokens for the fixture) | recorded fixtures | Fails if the digest grows |
| Manual | Per-milestone checklist: 3 real clips, 1 long-form, notes round, sync check on headphones, 3 platforms playback | human | Sign-off |

### 13.2 Golden-frame harness

`fixtures/projects/<name>/{sources/,edl.json,style/}` plus `fixtures/frames/<name>/<frame>.png`. The harness renders specific frames via `video_render scope=stills`, compares with SSIM, and writes a diff heatmap artefact on failure. Fonts are pinned binary files in `fixtures/fonts/` with a manifest hash — a font substitution is a *test failure*, not a silent restyle, which is the single most common cause of "it looked different on the render machine".

### 13.3 What we deliberately do not test

Pixel-perfect equality of Chromium output across macOS/Linux/Windows (documented as machine-local determinism, §5.5.5); the agent's actual prose (model output is not a test target — the *tool sequence* and *tool results* are); HyperFrames internals (contract-level only, behind the renderer seam).

---

## 14. Risks and mitigations

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | **Out-of-tree client plugin contract can't be reproduced** (S2) | M | **H** | Spike first; three fallbacks pre-designed (§12.1); worst case is a mildly degraded integration, not a dead project |
| R2 | HyperFrames range render re-bases time or is non-deterministic (S3) | M | H | `timebase: 'segment'` compile mode; determinism by pinning + SSIM gates rather than hashes |
| R3 | Render wall-clock misses NFR-03/04 on real hardware | **H** | M | Measured on the actual dev machine (i7-3720QM/8 GB): T0 is fine (0.6× realtime), T1 is the bottleneck (≤2 Chromium workers, ~13 GB/s memory pressure) → tier discipline, 540p preview, and **shifting long-form work to a faster box is an accepted deployment answer, not a workaround**; measure again in week 2 |
| R4 | Cheap model produces poor cut/caption decisions | M | H | Digest-first tools, deterministic geometry, `dryRun` diffs, lint gates, escalation rule: after two failed note rounds, re-plan with `v4-pro` |
| R5 | Word-anchored EDL is over-engineered for v1 | M | M | Anchors have a `time` escape hatch; the resolver reports dangling anchors instead of failing; MVP uses word anchors only where they pay (captions, B-roll) |
| R6 | Pane scope creep into a full NLE | **H** | M | v1 pane is read+notes+drag only; trimming clips is explicitly deferred (§16-Q3); any new interaction needs a `core` op and a dirty-interval test |
| R7 | Font/typography quality disappoints | M | H | Presets ship with golden frames and licensed fonts; typography is reviewed as an image artefact, not as a vibe |
| R8 | Audio seams / loudness inconsistency | L | M | Audio is always mixed full-length per revision (never per segment) |
| R9 | Long-form (14 min) memory/CPU blowups | M | M | Per-chapter chunking for analysis and planning; segment plan capped; refuses to plan a >40-min single-pass render — splits into parts |
| R10 | Disk growth from proxies + segment cache | M | L | Content-addressed GC command with a size budget; proxies derivable, so evictable |
| R11 | Vision QA leaks footage to a cloud model | L | M | Off by default in settings; explicit opt-in with a one-line explanation; contact sheets only, never audio |
| R12 | Single developer bus factor | H | M | This document + ADR log + the skill's references are the handoff; fixtures are the executable spec |
| R13 | Licensing of user-supplied B-roll/music | M | M | Asset records carry `licence` + `source`; `asset-licence-ok` rule warns on unknown licence before final render |

---

## 15. Decision log

| ID | Decision | Rationale | Reversible? |
|---|---|---|---|
| ADR-001 | DSH-native, out-of-tree package set installed as a `web`-profile bundle | Reuses session/approval/jobs/subagents; no DSH fork to maintain | Yes (could move in-tree later) |
| ADR-002 | Pane ↔ host over our own `/video` HTTP route + SSE, not a `/remote` namespace | `/remote` requires editing a build-time-fixed array in the DSH repo | Yes (swap to RPC channel or `/remote` if we ever go in-tree) |
| ADR-003 | HyperFrames as the Chromium renderer, behind a `Renderer` seam | Apache-2.0 unencumbered, has `--start/--end` + `--resume`, agent-native docs; Hypit's licence forbids multi-tenant use | Yes (seam exists; Remotion/own renderer possible) |
| ADR-004 | Word-anchored EDL with an explicit projection step | Borrowed from Hypit; the only way a text edit re-flows downstream timing correctly | Yes, via the `time` anchor escape hatch |
| ADR-005 | Segment as the unit of rendering, content-addressed | Makes note rounds cost proportional to what changed — the core requirement | No (this is the product) |
| ADR-006 | Audio always re-mixed per revision, never per segment | Cheap, avoids seams and loudness drift | Yes |
| ADR-007 | Style = prose skill **+** executable rules with code-backed validators | "Never makes the same mistake again" must be deterministic, especially on a cheap model | Yes (rules are additive) |
| ADR-008 | Deterministic geometry solver; the model never computes pixels | Cheap models are unreliable at arithmetic; the solver is testable | No |
| ADR-009 | Notes are durable session messages (via `agent.followup`) with a file mirror | No new session event types needed out-of-tree; notes join the real context and are forkable | Yes (RPC/event alternative exists) |
| ADR-010 | Two render grades: preview 540p / final 1080p, separate segment namespaces | Iteration cheap, delivery good; matches the reference's 720p-then-1080p logic | Yes |
| ADR-011 | Relative deltas for direct manipulation | Absolute positions break on re-flow | No |
| ADR-012 | Rule violations warn in preview, soft-block `final` | Visible objection beats silent correction | Yes |
| ADR-013 | **Hosted ASR by default (OpenAI `whisper-1`), local fallback**; faces and encoding stay on-device; vision QA opt-in | Hosted transcription is better and much faster than CPU whisper on the target hardware, and it is the single highest-leverage artifact in the pipeline — "let the AI do the heavy lifting". Video never leaves the machine | Yes (flip the provider setting to `local`) |
| ADR-014 | 8 presets in v1, not 20+ | Quality per preset (golden frames, inspector, tier fallback) beats breadth | Yes |

---

## 16. Open questions for review

These can still change the design. Answers before week 1 avoid rework; the ones marked **blocking** must be answered before the phase noted.

| # | Question | Why it matters | Default if unanswered |
|---|---|---|---|
| **Q1** | **Scope ladder (§12.2): confirm MVP+v1.0 (8 weeks) as the target, or insist on all of v1.1 in one push (12 weeks)?** | Determines whether podcast/multi-cam and batch land now or next cycle | Plan MVP+v1.0; v1.1 as a follow-on |
| **Q2** | Do you have brand assets/specs — fonts (the reference uses Ivy Presto), caption style, colour, logo, safe-area conventions? | Typography quality is the single most visible thing; without fonts we ship approximations that get restyled later | Ship 8 presets with licensed lookalikes (Inter Tight / Archivo / Bebas-style) and swap on request |
| **Q3** | ~~Pane interaction level~~ **Deferred — "let's play with it later."** Ship review + notes first (F1–F3), then a **timeboxed 3-hour drag experiment (F4)** so the decision is made by using it. No architecture change needed: overlays already move by relative-delta patches, so direct manipulation is purely additive | — | F1–F3 committed · F4 = experiment · timeline NLE still out of scope |
| **Q4** | Typical footage: how many cameras, what resolution/fps (4K60 iPhone? 1080p webcam?), and typical raw length? | Decides proxy settings, worker defaults, whether 4K finals are local-feasible | Assume single 4K30/1080p30 source, 3–20 min raw |
| **Q5** | Target platforms and their specs (TikTok/Reels/Shorts 9:16, YouTube 16:9, LinkedIn 1:1?) and do you want per-platform safe areas configured? | Drives `OutputTarget` defaults and the safe-area rules | 9:16 + 16:9, standard safe areas |
| **Q6** | Will clients/reviewers need to leave notes too (share link), or is the reviewer always you? | Determines whether review state needs identities, threads and approvals in v1 | Single reviewer; multi-reviewer deferred |
| **Q7** | Where does music/SFX come from (library folder, Artlist/Epidemic, YouTube Audio Library)? Any licences we must record? | Needed for the `asset-licence-ok` rule and for AI-asset policy | Local library with a `licence` field, unknown = warn |
| **Q8** | ~~What machine will render?~~ **Answered by probe (see §3.3 NFR-13):** Intel i7-3720QM, 8 threads, **8 GB RAM**, 154 GB free, Chrome 156, FFmpeg 7.0.2, VideoToolbox H.264 available; no whisper installed yet; Docker present. **Follow-up:** is this the machine you intend to *ship* on, or a dev box with a faster render target later? | Sets worker counts, the 4K feasibility, whisper model size, and whether Chromium-tier templates are viable at all here | Plan for this machine: T0-first, ≤2 Chromium workers, hosted ASR (local whisper only as fallback), preview at 540p |
| **Q9** | **Is it acceptable for contact-sheet frames of your footage to be sent to the DeepSeek vision model for QA?** (blocking, Phase 4) | Privacy-relevant; see §5.8 | Off unless explicitly enabled; deterministic lint works without it |
| **Q10** | Should the agent also produce publishing metadata (title, description, hashtags, thumbnail) as part of delivery? | Adds a small but visible deliverable; affects `video_deliver` | Include title/description/hashtags in `delivery.json`; thumbnails from a stills render |
| **Q11** | English only, or must captions support other languages / translation? | Multilingual changes the transcription seam and the caption pipeline | English only in v1 |
| **Q12** | Do you want this document split for the team (architecture / pane / renderer / skills as separate files)? | Easier review per owner, more files to keep in sync | Keep one file; split when a second person joins |
| **Q13** | For reels-from-long-form: should the agent *choose* the highlight windows (autonomous) or should you mark them and have it build? | Changes the UX of D6 substantially | Agent proposes 3–5 candidates with a one-line rationale each; you pick |
| **Q14** | Naming: "DSH Studio", or something else? (affects package scope and pane label) | Cheap to change now, annoying later | `dsh-studio` scope, pane labelled "Studio" |
| **Q15** | ~~Which ASR provider?~~ **Answered: OpenAI.** Adapter targets `whisper-1` + `timestamp_granularities[]=word` (ADR-013, §8.4). The key is still needed for B2's live verification | — | `OPENAI_API_KEY` in `~/.dsh/.credentials.yaml` or `studio/.env` |
| **Q16** | Audio leaves the machine for transcription. Fine for all footage, or should individual projects be markable "no upload"? | Matters for client work under NDA; the flag is ~20 lines | Upload by default (implied by choosing OpenAI); a per-project `keepLocal` flag lands in v1.1 unless you say otherwise |

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Anchor** | A timing reference to something meaningful (word id, silence edge, beat, clip edge) rather than a raw second |
| **Assembly** | Concatenation of cached segments into a playable file, no video re-encode |
| **Derivation** | A second output cut from a parent timeline (a vertical reel from a long-form edit) |
| **Dirty interval** | The program-time span that a patch actually changed, expanded for transitions and snapped to GOP boundaries |
| **Digest** | The compact textual state of an edit that the model reads instead of JSON |
| **EDL** | Edit decision list — the single source of truth for an edit |
| **Projection** | The pass that maps word/beat/silence anchors onto absolute program frames |
| **Segment** | A render-atomic slice of the timeline, content-addressed and cached |
| **T0/T1/T2** | Render tiers: FFmpeg-only / Chromium / pre-baked assets |
| **Preset** | A named bundle of typography, layout policy, motion and tier requirement |

---

## Appendix B — Reference stack and install commands

### B.1 Verified DSH facts this design depends on

| Fact | Where |
|---|---|
| Client plugin = package with `dsh.client: { platform: 'web' }` + `exports["./client"]`; bundle served at `/plugins/<id>/client.js`, composed into `window.__DSH_BOOT__` | `docs/subsystems/client-modules.md` |
| Browser half is a CJS closure factory (`window.__ModuleLoader__.load({id, factory})`), CSS injected at first require | `packages/client/tsdown.client.ts:555-565` |
| UI is slots: `ctx.slots.inject(key, () => ctx.slots.register(opts, Component))`; `conversation.view` is a list slot with `id/order/label`; no router exists | `packages/client/ui-conversation/src/client/contract/slots.ts`, `ui-slots/src/index.ts` |
| A full HTTP carrier exists: `ctx.webServer.register({kind:'exact'|'prefix', path, handler})`, handler owns raw `node:http` objects | `packages/host/webserver/src/index.ts:42-115` |
| **No `Range` support exists anywhere in DSH** — we implement `206`/`Content-Range` ourselves | verified by exhaustive search of `packages/host|client|api` |
| Registered routes sit outside the `/api` trust fence (loopback + `sec-fetch-site` checks are ours to reimplement) | `packages/client/connection/src/api-request-trust.ts` |
| Tools: `defineTool({name, description, parameters, output:{schema, render, presentationMeta}, execute, timeoutMs, isConcurrencySafe})`; args validated before `execute`; `exec.signal` must be honoured | `packages/core/tools/src/index.ts:212-260`, `docs/subsystems/tools.md` |
| Policy gating via `tools/pre-execute` waterfall, `ctx.tools.guard`, and sandbox policy resolved inside the tool | `docs/subsystems/approval.md`, `sandbox.md` |
| Jobs: `ctx.jobs.start({kind, label, owner, run})`; `readOutput` makes it a consuming stream; completion wakes the owner; `maxConcurrentJobsPerOwner` default 10 | `packages/jobs/jobs/src/index.ts`, `docs/config-catalog.md` |
| Skills: `<root>/<name>/SKILL.md`, kebab-case name + description required, project root ranks `<git-root>/.dsh/skills` highest | `docs/subsystems/skills.md` |
| Commands: `ctx.commands.register({name, description, input?, handler})`; results never reach the model | `docs/subsystems/commands.md` |
| Models: `deepseek-v4-flash` (default), `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp` (image input); per-subagent `agentOptions` | `packages/llm/llm-deepseek/src/index.ts:83-95`, `packages/bundle/base/cordis.patch.yml` |
| Install: `dsh plugin --profile <name> add ./pkg`, bundle declares `dsh.bundle`, profile lists it in `dsh.profile.bundles`; later layers win per row | `docs/user/develop/basic/publish.md` |
| A new `/remote` namespace requires editing a build-time array in the DSH repo | `packages/api/remotes/src/client/index.ts:113-121` |

### B.2 Stack

Node 22.19+/24 · pnpm 11 · FFmpeg 7.x with `libass`, `libx264`, `libzimg` · hosted ASR key (ElevenLabs/Deepgram/Groq) · `onnxruntime` + YuNet for local face detection · Chromium (pinned, via HyperFrames or Chrome-for-Testing) · GSAP 3 · DSH ≥ the checkout in `~/Desktop/deepseek-harness` (the exact version must be pinned in the bundle's dependency list).

### B.3 Shape of the bundle patch layer

```yaml
# packages/bundle/cordis.patch.yml
- insert:
    - id: video-ingest
      name: 'dsh-video-host-ingest'
    - id: video-render
      name: 'dsh-video-host-render'
    - id: video-style
      name: 'dsh-video-host-style'
    - id: video-qa
      name: 'dsh-video-host-qa'
    - id: video-server
      name: 'dsh-video-host-server'
    - id: video-tools
      name: 'dsh-video-host-tools'
    - id: video-client-pane
      name: 'dsh-video-client-pane'
```

```json
// packages/bundle/package.json (essentials)
{
  "name": "dsh-studio",
  "version": "0.1.0",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "dsh-video-host-ingest": "workspace:*", "dsh-video-host-render": "workspace:*",
    "dsh-video-host-style": "workspace:*", "dsh-video-host-qa": "workspace:*",
    "dsh-video-host-server": "workspace:*", "dsh-video-host-tools": "workspace:*",
    "dsh-video-client-pane": "workspace:*"
  }
}
```

---

*End of specification. Nothing in this document has been implemented yet; §12.1 is the first thing that runs, and §16 is the first thing I need back from you.*



