# Build State — live ledger

One row per step. **A step is `pass` only when the verification command's output is pasted here.** States: `todo · wip · pass · fail · blocked · cut`.

Last updated: session 11 — **all eight of the owner's notes are done**, including the timeline. The pane and the renderer are feature-complete for short-form; what remains is window selection, a B-roll library, and drag-to-position for graphics.

## Gates

| Step | State | Verification | Notes |
|---|---|---|---|
| S0 segment-cache mechanism | **pass** | `proofs/segment-cache/`: 14.2 s cold vs 4.2 s incremental (3.37×), untouched segments sha256-identical, caption band YMAX 209→235 | pre-spike; ADR-005 evidence-backed |
| S1 `agent.followup` from host plugin | todo | — | A4 |
| S2 out-of-tree client bundle boots | **pass** | headless-Chrome probe (`scripts/ui-probe.mjs`) against :3099: 43/43 plugin bundles fetched incl. ours · `window.__DSH_STUDIO_DIAG__` = `{applyCalled:true, injectCallbackRan:true, registered:true, error:null}` · with a conversation open, `aria` tabs = `["Chat","Trajectory","Studio"]` · clicking Studio → `paneMounted:1`, pane text `"Studio pane online … ticking 3s"` | **gate green.** Fallback (d) not needed. Two caveats recorded below |
| S3 HyperFrames range render + determinism | **pass** | window `--start 6 --end 9` vs `full[6…9)`: **mean SSIM 0.999892** (control vs `full[0…3)`: 0.880) · two identical window renders: **90/90 decoded frames byte-identical** (`framemd5`) · throughput table in `proofs/hyperframes/README.md` | **gate green.** Absolute-time windowing confirmed → `timebase:'absolute'`, no per-segment re-basing needed. **New constraint discovered: ~13.6 s fixed overhead per Chromium render** |
| S4 Range media route + scrub | todo | — | A3 |
| S5 hosted ASR adapter — OpenAI `whisper-1` | todo | — | B2 — provider decided; **blocked only on the key** |

## Phase A — foundation

| Step | State | Verification | Notes |
|---|---|---|---|
| A0 workspace skeleton + `doctor` | **pass** | `pnpm -s typecheck` → exit 0 · `pnpm -s test` → **5/5 pass** (schema round-trip, invalid anchor, duplicate ids, min>max span, bad clip id) · `pnpm -s doctor` → *Hard requirements satisfied* (node 22.19, ffmpeg 7.0.2 + ass/subtitles/overlay/zoompan/sidechaincompress/loudnorm/silencedetect, libx264, VideoToolbox, Chrome 156, 376 system font faces, 154 GB free) | pnpm 11.7.0 + zod 3.24 installed; `esbuild` build script ignored by pnpm (harmless: tsx/vitest both run). Doctor warns on: no project fonts, no ASR key, no real footage, no global `dsh` CLI |
| A1 spike S2 | **pass** | see gate row S2; composition verified with `--dump-config` (`# == @deepseek-ai/dsh-web-app, patched by dsh-studio`, webserver port 3099) | **8 gotchas**: linked-bundle deps · in-box web bundle · `workspace:*` boundary · sourcemap/footer ordering · private `@deepseek-ai/*` types · `dsh web` profile alias · **`conversation.view` paints only inside an open conversation** (the tab is absent on the session-list screen — cost one false "missing tab" report) · **Chrome needs `--no-sandbox --disable-crash-reporter --disable-breakpad` + an isolated `--user-data-dir` to run inside the harness sandbox** (it dies silently otherwise) |
| A2 spike S3 | **pass** | see gate row S3; measurements in `proofs/hyperframes/` | Decided: `timebase:'absolute'`. Consequences pushed into the ledger: T1 batching (coarse runs), T0-first (§D2/D3), NFR-04 revised. Follow-up **S3b** opened for warm-browser reuse |
| A3 media route | todo | — | `206`/`Content-Range`/`416`/traversal tests |
| A4 spike S1 | todo | — | — |

## Phase B — media spine

> **Unblocked.** Both architecture gates are closed. Waiting on one real clip (B-2) and the OpenAI key (B-1).

| Step | State | Verification | Notes |
|---|---|---|---|
| B1 probe/proxy/audio | **pass** | probe: 3840×2160@60.04 (VFR flag: no) · hevc · 2.71 GB · 480.0 s · aac 2ch/48 kHz — 0.4 s · fingerprint (head+tail+size) 0.0 s · **audio ✓** 48 kHz stereo 92.2 MB + 16 kHz mono **15.4 MB** (under the 25 MB ASR limit), 480.02 s · preview + scrub rendering | Final timings on the real clip: **preview 540p 1963.7 s (32.7 min), scrub 270p 13.8 s, audio ~8 s**, total 1979 s. Artifacts: scrub 67.6 MB · preview 80.9 MB · audio 87.9 MB + 14.6 MB. **Ingest was reordered by measurement**; two self-inflicted bugs fixed: `.part` suffix broke ffmpeg's muxer inference; a killed encode left a file that looked complete (now atomic rename + per-step cache) |
| B2 ASR seam + OpenAI adapter | **pass** | `packages/host-ingest/src/asr/openai.ts` + 8 tests green: refuses non-`whisper-*` models (no word timestamps), maps verbose_json → validated `Transcript` with stable `w-####` ids, sends both `timestamp_granularities[]`, retries 5xx but not 4xx, computes cost, fails loudly on zero words; `parseSilencedetect` covered too | **13/13 tests pass.** **Live:** 14.6 MB upload → **36.9 s**, **720 words / 96 segments**, 1 request, **$0.048**, language auto-detected **russian**, speech 14.4 s → 480.0 s, cached to `analysis/transcript.src-01.json` |
| B3 silence map | **pass** | `detectSilence` on the real 8-min audio: **136 regions, 123.9 s of silence (25.8 % of the file)**, longest pauses 3.8–6.0 s, 180 regions under 400 ms; detected in **1.07 s** (vs ~35 min to decode the video) | This is the deterministic basis for "cut every pause" |
| B4 face tracks | todo | — | ship `faces-null` if ONNX fights back |
| B5 resolver + projection | todo | — | golden snapshots + projection property |

## Phase C — edit model

| Step | State | Verification | Notes |
|---|---|---|---|
| C1 ops + diff + dirty intervals | todo | — | **dirty-minimality property, 500 cases** |
| C2 digest ≤400 tokens | todo | — | snapshot |
| C3 segment planner | todo | — | GOP snap + tiling property |

## Phase D — T0 renderer

| Step | State | Verification | Notes |
|---|---|---|---|
| D1 ASS captions | todo | — | human checkpoint H2 |
| D2 segments + assembly + manifest + audio mix | todo | — | **must beat 14.2 s / 4.2 s baseline** |
| D3 CLI end-to-end | todo | — | second run `30/30 cached` in <2 s |

## Phase E — agent surface

| Step | State | Verification | Notes |
|---|---|---|---|
| E1 five core tools | todo | — | includes `read-only` refusal test |
| E2 skill bundle | todo | — | — |
| E3 flash conformance harness | todo | — | ≥90% of cases |
| E4 notes → agent bridge | todo | — | 5 notes → 1 message → 1 turn |

## Phase F — pane (after A1)

| Step | State | Verification | Notes |
|---|---|---|---|
| F1 shell + playback | todo | — | checkpoint H3 |
| F2 overlay compositing | todo | — | geometry asserted numerically |
| F3 timeline + notes rail | **pass** | scrub bar with playhead, drag selection, note pins; a note at program 30.0 s suppressed 12 caption pages: ink 0 inside its window, 1073–1972 outside | session 10 |
| F4 drag experiment (3h timebox) | todo | — | **optional by design** — Q3 deferred; cut it if it does not feel good |
| F5 lint badges | todo | — | — |

## Phase G–H — v1.0 tail

| Step | State | Verification | Notes |
|---|---|---|---|
| G1 rules + validators | todo | — | 13 validators × 3 fixtures |
| G2 stills + verify-frame | todo | — | ≤2 s |
| G3 style_learn + blast radius | todo | — | — |
| G4 vision QA | **blocked** | — | Q9 / B-5 |
| H1 derivations + reframe | todo | — | — |
| H2 deliver | todo | — | — |
| H3 batch | todo | — | — |

## Testing guide, and two UX defects found while writing it (session 14)

Wrote `docs/TESTING-GUIDE.md`: seven workflows with the exact expected output at each step, the
approval-per-command caveat for the GUI agent, a list of known limitations so they are not reported
as bugs, and a report template.

Writing it forced two fixes, because both would have read as "the app is broken":

| Defect | What the tester would have seen |
|---|---|
| the final ffmpeg ran **synchronously**, so nothing was printed during a render | press Render, then **a silent minute** — indistinguishable from a hang. Now `-progress pipe:1` streams `…encoding 10% … 90%` into the pane's log |
| a second render request while one was running returned **409 BUSY** as an error | changing two settings quickly showed "a render is already running" in red. Now the second is **queued**, with a blue line saying so |

Also verified every control label the guide names exists in the code (14/14), that the guide's warning
about `Instruction` notes is accurate (`· needs the agent: "make captions bigger here"` in the render
log), and restored the project to the exact state the guide documents.

## Window selection (session 13)

The window was hardcoded to `4:47–5:47` in two places, so every feature was stranded on one minute
of an eight-minute recording. It is now a **project property**: `project.json.window`, edited from
the pane, obeyed by the renderer, with the auto-generated highlight candidates offered as one-click
choices.

Verified by switching to a different minute (6:50–7:43) and rendering it: **program 43.7 s**, captions
present, font Oswald, 12/12 frames clean.

Two defects the switch exposed — both invisible while the window never changed:

| Defect | Why it appeared only now |
|---|---|
| `render-clip` accepted only `m:ss`; the server sends seconds (`411`) | every programmatic render would have produced `NaN` — the fail-fast added earlier turned it into an error rather than a nonsense render |
| the caption baseline used the **median** chin | within one window the speaker sits lower and larger (chin 389–463 px around a 416 median), so the median put captions on the face for the lowest frames — 5,738 pixels of overlap, caught by the placement gate |

The baseline is now the **p90** chin: one fixed position and one fixed size, clearing almost every
frame. Re-verified on both windows (0 pixels over the face on each).

## The pane → agent bridge (session 13)

The gap that made the pane a settings panel rather than a director's chair: nothing in it could ask
the model anything. Free-text notes were *logged* and ignored ("needs the agent").

**Built and proven.** `POST /video/api/ask` resolves the session's live agent through `ctx.agents`
and submits the request with `agent.followup`. Out-of-tree plugins cannot import the harness's
private `@deepseek-ai/dsh-llm`, so the `UserMessage` is constructed directly — it is a plain frozen
`{ id: uuid, role: 'user', content, source }`, and the harness's `createUserMessage` adds nothing
this does not.

Evidence from the durable session log after clicking the pane's button:

```
seq 115  agent/inbox/spliced   ← the bridge message, with project paths and current settings
seq 116  turn/start            ← the agent opened a turn
seq 278+ tool/call (bash)      ← it began inspecting projects/test-vid
seq 515  approval/asked        ← blocked
```

**The one thing standing in the way is the environment, not the bridge.** The GUI session's
`workspace-write` sandbox backend cannot start on this macOS host (`sandbox-exec: Operation not
permitted`), so the agent's bash is refused and it asks for `danger-full-access`. That is the same
family of problem as Chrome needing `--no-sandbox` and `~/.dsh` being unwritable: this host does not
permit nested macOS sandboxing. One approval in the GUI unblocks it.

Two buttons now exist in the pane — **Plan cuts with AI** and **Ask for a review** — and both submit
through the bridge. What the agent does with them depends on it being able to run tools.

## AI cut planning (session 12) — can the model decide when to jump-cut?

Asked by the owner. Yes, within a specific and honest boundary.

**What the model is good at**: judging a pause from its sentence context. On the 4:47–5:47 window it
made 11 decisions, and the categories differ in a way no global setting can express:

| kind | count | example |
|---|---|---|
| stumble | 3 | «что же делать я не знал ⟪⟫ он мог это сделать» — a false start; cut hard so the viewer never sees it |
| filler | 3 | «…деноминации ⟪⟫ то получается…» — mid-sentence connective; cut |
| breath | 2 | sentence boundary; keep 140 ms so the speech is not staccato |
| beat | 3 | after «не правда ли?» — **keep 700 ms**, the silence IS the emphasis |

**What it cannot judge yet**: visual jumps. A hard cut is safe in audio and risky on picture when the
speaker is mid-gesture or shifts position. That needs frame differencing around each cut point, which
is not built.

**Plumbing matters as much as the model.** The first implementation applied retention AFTER merging
pauses, which lost the pause's original key (so plan decisions silently missed) and halved an
explicit decision. Reformulated: retention is a property of the pause itself — keeping N ms is the
same as cutting from `pauseStart + N` onward — decided before any merging. Verified: 10/11 decisions
land at exactly the requested retention.

Result on the same minute of footage: **hard cuts 55.17 s · AI plan 55.29 s · global calm 56.44 s**.
The plan is nearly as tight as cutting everything, because the millimetres it spends are spent only
where an editor would spend them.

## Sessions 10–11: the last three of the eight notes

### Mumbles (session 11)

`detectMumbles` removes three different things, each with its own justification: **sound with no
transcribed word** (the largest source — 29 regions / 11.8 s on the reference clip), hesitations,
isolated discourse markers, and false starts. Whole clip: **24 cuts, 8.5 s**.

The rule the owner's own footage dictated: **`это` is never cut**. It appears 15 times and is almost
always content ("это полнейшая чушь", "что это означает"). A generic filler list would have broken
those sentences.

Invariant verified: of 14 transcribed words removed, **14 were justified by a word-level rule and 0
were swallowed by the bulk "no words here" rule**. 21 unit tests pass.

### Timeline (session 10)

A scrub bar with playhead, drag selection, colour-coded note pins and a composer with five note
kinds. Notes are stored in **source time**, not program time: program time shifts on every re-cut, so
a note saved in program time would slide onto a different sentence after the next render. A note
whose exact moment gets cut clamps to the nearest surviving edge rather than vanishing.

Three bugs found while building it:

| Bug | Consequence |
|---|---|
| **`pnpm typecheck` never covered `scripts/`** (no tsconfig included it) | the renderer had been type-unchecked for eight sessions; adding `tsconfig.scripts.json` immediately found an undefined variable and two use-before-declaration errors |
| captions "hold until the next page" painted straight across a window a `hide-captions` note had cleared | the hold now stops at the next suppressed range |
| boolean settings were stored as the strings `'on'`/`'off'` | `'off'` was truthy, so **captions could never be turned off** |

### Image notes (session 11)

`GET /video/api/assets` lists `projects/<slug>/assets`; the pane offers a picker when the Image note
kind is chosen. Placement is derived from the **face track**, not a fixed corner: the speaker's face
centre is at x=527 of 960, so the note's image rendered at **x 76..145 (left)** with 2,564 px of ink
inside its window and nothing outside it.

Known limits, stated in the pane: fixed 32 % width, automatic side, no drag-to-position, no vertical
control.

### The habits that actually caught things

1. Every control renders into a **separate folder** from deliverables — the pane once showed a
   captionless verification control as if it were the result.
2. Every check needs a **settings-matched control**. Three separate measurement errors came from
   comparing against the wrong file: motion differences, a different grade, and a stale path.
3. An **inconclusive** check is a **failure**. A run that skipped every frame once reported PASS.
4. **The interface must not claim what it has not verified.** Three of four pane bugs were claims:
   "this is the latest render", "this setting is applied", "captions are on".

## Owner feedback on the pane, and the four bugs behind it (session 9)

The owner tried the pane and reported: no captions; clicking buttons changes nothing; switching to
horizontal does nothing; background too dark. All four were real.

| Report | Actual cause | Fix |
|---|---|---|
| "I see no captions" | the pane displayed **my own verification control** (`--no-captions`) because "latest render" was a filename heuristic (newest mp4 not named `*nocaps*`) | the server now records `project.json.lastRender` (file, settings, captions flag) when a render finishes; `state` returns that and nothing else. Controls render into `out/controls/` so they can never be watched |
| "clicking buttons does nothing" | settings persisted but nothing re-rendered, and nothing said so | the pane marks itself dirty and auto-renders on change (toggleable), with a loud "Settings changed — press Render" banner when auto is off |
| "switching vertical→horizontal does nothing" | horizontal + a blurred background was **rejected** by my validation, and the rejection surfaced only in a corner of the panel | dependent settings are now **coerced with an explanation banner** ("background reset to None — only applies to vertical") instead of failing |
| "background is too dark" | my grade: brightness −0.18 and saturation 0.55 on an already dim room | measured fill luma **9 → 21 → 42**; the darkening is gone entirely and the fill is now slightly brighter than neutral |

Verified after: the deliverable the pane shows is `test-vid-deliverable.mp4`, 540×960, with 681 bright
pixels in the caption band at t=20 s (i.e. captions on screen), and the pane reports the file the API
recorded rather than a guess.

**Lesson:** three of these are the same mistake in different clothes — a UI that shows state it has
not verified. The pattern to keep: when the interface claims something (this is the latest render,
this setting is applied), the claim must come from a recorded fact, not from an inference.

## Outside review, and what it caught (session 8)

Acting on the gstack conversation's one useful idea, a **fresh agent with no context reviewed the
diff**. It found a **critical** defect plus seven more, all now fixed and verified
(`b0c50d5`):

| # | Defect | Why it mattered |
|---|---|---|
| 1 | **critical** — a degenerate edit window produced an *empty* `select` expression, which ffmpeg treats as "select everything" | the renderer re-encoded the whole 480 s source, exited 0 and printed ✔. Reproduced by the reviewer, not theorised |
| 2 | one-word captions bypassed width fitting | 158 px type in a 540 px frame was clipped at both edges while the face gate passed |
| 3 | verifier rebuilt the timeline without the render's pace | face looked up up to 1.4 s from the frame under test |
| 4 | studio grade ran *after* the caption burn | type dimmed and vignetted (peak 225 → 255 after the fix) |
| 5 | background accepted and shown as selected, but a no-op for horizontal | a switch that lied; defaults changed to vertical+blur and the impossible combination is refused |
| 6 | face box from seconds away counted as evidence | a run could PASS with no face data; now 500 ms window + INCONCLUSIVE |
| 7 | render job could stay "running" for ever | no spawn-error listener, no timeout; added error handling + 15 min watchdog + eviction |
| 8 | `voicePolish` was a control that lied | renderer hardcoded it true; now honoured |

**The lesson worth writing down:** my own gates were passing while the output was wrong. Every one of
these was a *plausible* diff, and the measurement gates I built did not catch them because they
checked the wrong invariant. A reviewer with no stake caught what my tests were blind to.

## Background treatment (session 8)

Vertical delivery now **fits the whole frame over a blurred copy of itself** instead of cropping a
9:16 strip out of it. Cropping kept only ~32 % of the frame's width — losing the room and half of a
seated speaker's gesture. No subject matte is needed, so no halos around hair or hands.

Verified numerically: band sharpness in the fitted centre measures **4.11** against **0.03** in the
blurred padding (crop renders measure 0.61 in the same band, i.e. real image content), and captions
still clear the face on 12/12 frames with no edge clipping.

## Studio pane v1 is live (session 7)

The owner asked whether the GUI pane is coming. It is the product, so it moved to the front and a
working first version now exists in the harness at `:3099` → **Studio** tab.

**Built and verified** (`host-server` + `client-pane`):

| Piece | Verification |
|---|---|
| `GET /video/api/projects`, `state` | returns project, settings, option catalogue, latest render, live job |
| `POST /video/api/settings` | round-trips into `project.json`; an unbuilt value is **refused with the reason** instead of silently stored |
| `POST /video/api/render` | spawns the renderer; `state` reports progress; produced `out/test-vid-from-pane.mp4` (7.5 MB) end to end |
| `GET /video/media/<project>/out/<file>` | **206 + Content-Range** (`bytes 0-1023/7499705`, `video/mp4`); traversal → 404 |

Pane UI verified in a real browser (headless probe): 8 control groups, 15 enabled controls, and 7
options honestly disabled with their reason attached — Inter, Manrope, Calm pace, Vertical 9:16,
Blurred background, Studio backdrop, B-roll. The player streams the latest render.

Deliberately deferred inside the pane: timeline scrubbing, click-to-instruct notes, drag editing (P4).

## Owner review of the first cut (session 6) — the work list

Eight observations, each now a numbered requirement in `development-plan.md` §3.5 and a step in
`build-plan.md` §9b: sound not deep / captions too high (needs face detection) / pacing too fast /
vertical option / dated font / graphics layer / background behind speaker / an edit pane with
click-to-instruct.

Also corrected: **the stack is DeepSeek-first.** Verified that DeepSeek has no speech-to-text endpoint
(text + image only), so transcription is the single non-DeepSeek capability and is now **local whisper
by default** (ADR-013 revised), with the OpenAI adapter kept as an opt-in accelerator. The existing
transcript stands; this changes future runs only. `studio/.env` keeps the key until the owner deletes
it — it is gitignored, and rotating it was already advised.

## First real cut (session 6)

`pnpm render-clip test-vid --from 4:47 --to 5:47 --label option2` → `studio/out/test-vid-option2.mp4`

| check | result |
|---|---|
| container | 960×540 H.264 + AAC **48 kHz** stereo · **55.30 s** · 6.9 MB · rendered in **27 s** |
| loudness | **−14.2 LUFS** integrated, peak **−2.5 dBFS** |
| pauses removed | source 136 silence regions / 25.8 % dead air → **1 region remaining** |
| captions burned | caption band **10 343–12 764** bright px vs **2 541–4 869** in the uncaptioned source |
| caption pages | 131 words → 37 pages (3.5 words/page), all inside the safe area |

New modules: `host-render/cut.ts` (pause-free program compaction + word retiming), `host-render/captions.ts`, `scripts/{render-clip,verify-captions,qa-transcript,cut-plan}.ts`.

Four bugs of mine found by verification rather than by review, all fixed: `loudnorm` applied to a video stream; ASS path with spaces breaking the filtergraph; proxy is video-only so audio must be paired explicitly; `loudnorm` leaving the output at 96 kHz until `-ar 48000` was pinned.

Still open for this clip: the output is **16:9 at preview resolution** — a 1080×1920 vertical master needs either a full re-decode (~35 min) or face-follow cropping, which is not built yet.

## Installed reference: Hypit skill (session 5)

`npx skills add hypit-ai/hypit --all` → `studio/.agents/skills/hypit` (764 KB, 40 reference files). **Gitignored** — it is third-party text and must not enter our repo. Deliberately *not* placed at the repo-root `.agents/skills`, so DSH does not load it into agent sessions alongside our own workflow.

Taken from it (ideas only): the talking-head recipe name `pause-trim-jump-cuts`; caption grouping by meaning rather than word count; fit by measured advance width at delivery size; two-line pages are legitimate; karaoke is a `current`/`trail` × `step`/`wipe` choice; hide captions during demonstrations; fonts travel with the build as files with synthetic bold disabled. Four of these became rules in §6.6 and one became a preset constraint in §8.2.

Not taken: its runtime, its SVML authoring model, its generation-provider pipeline. Its licence (Apache 2.0 **+ no multi-tenant, no commercial redistribution**) forbids building our product on it — ADR-015.

## Findings worth keeping (session 5) — the footage is Russian, and the timestamps are not what I assumed

1. **The clip is Russian** (718/720 words Cyrillic; whisper's `russian` detection was correct, not a misdetection). Consequences: caption presets need a Cyrillic-capable font (Arial Bold / Arial Black / Impact are present on this machine and cover Cyrillic); Q11 ("English only") is void; and the "max 4 words per page" rule is unusable — the longest words here are `Фундаментальная` (15 chars), `протестантская`/`вышесказанного` (14). **Caption pages must be fitted by measured width, not word count.** The layout solver already measures; the *rule catalogue* changes from a word cap to a width/advance target.
2. **`whisper-1` word timestamps are contiguous, not acoustic.** **546 of 719 inter-word gaps are exactly 0 ms** — the provider subdivides its segment windows rather than aligning each word to the waveform. Karaoke highlighting is safe; per-word isolation ("this word starts exactly here") is not. **A refinement pass is now a required work item**: VAD-guided redistribution inside each segment (we already have a per-audio silence map to do it with).
3. **6.5 % of words drift into detected silence** (47/720). Blind caption pages would put text over dead air — the most visible failure mode in short-form. Caption spans must snap to the silence map, and `pnpm qa-transcript` now measures this so it cannot regress.
4. Coverage is otherwise healthy: words cover **94.9 %** of detected speech, 128 words/min, 89 real pauses >400 ms.

New tool: `pnpm qa-transcript <project>` — deterministic transcript QA (coverage, drift, contiguity, script mix, longest words) with a plain-language reading of the numbers.

## Findings worth keeping (session 4)

1. **4K60 HEVC decode on this machine is 0.24× realtime** (10 s slice → 41.5 s; VideoToolbox *slower* at 0.19×). An 8-minute master costs **~35–45 min** to ingest; a 14-minute one would be ~90 min. Ingest is now ordered audio → preview → scrub, with the scrub proxy derived from the 540p preview instead of the master (one 4K decode, not two).
2. **Audio work is essentially free by comparison**: extraction in seconds, silence map in 1.07 s for 8 minutes.
3. **25.8 % of this clip is dead air** — the pause map is the largest single source of cut material, and it needs no model.
4. Two bugs of my own, both now guarded by design: `.part` suffixes break ffmpeg muxer inference (keep the extension); a killed encode leaves a file that "exists" and would be cached as complete forever (atomic rename).
5. The project record is written **before** proxies finish, so transcription can start while a long encode runs.

## Human checkpoints (the user's eyes; I cannot see images)

| # | When | What to look at |
|---|---|---|
| **H0** | **now** | <http://127.0.0.1:3099> — start a chat session, confirm a **Studio** tab appears next to Chat and shows "Studio pane online" with a ticking counter |
| H1 | after B5 | the resolved overlay geometry JSON for one fixture frame — does the description match the video |
| H2 | after D1 | one burned caption frame (`studio/.cache/checks/h2.png`) |
| H3 | after F1 | the pane plays and scrubs |
| H4 | after F4 | drag a caption; does it feel right |
| H5 | after F3 | leave 7 notes like the reference author did |
| H6 | MVP | the full D1–D4 demo on one of your real videos |

## Blockers

| # | Need | Blocks | Status |
|---|---|---|---|
| B-1 | **`OPENAI_API_KEY`** (provider decided: OpenAI; key still needed for B2's live verify) | real transcription | **open** |
| B-2 | one real clip | B1 onward | **resolved** — `test-vid.mp4`, 4K60 HEVC, 8 min, 2.71 GB |
| B-3 | caption fonts (Q2) | D1 typography | open (lookalikes until then) |
| B-4 | ~~pane interaction depth (Q3)~~ | — | **resolved: deferred; F4 is a 3h experiment** |
| B-5 | vision QA consent (Q9) | G4 | open |
| B-6 | preferred DSH invocation | GUI booting | open (using `pnpm dsh`) |
