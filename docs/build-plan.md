# Build Plan — execution plan for the agent

**Who this is for:** me, the agent doing the building. The user reviews and unblocks. Every step below is written so that it ends in a command whose output proves the step worked — there is no step that ends in "looks done".

**Supersedes** `development-plan.md` §12 for *execution* (that section remains the team-facing roadmap). The architecture, data model and contracts stay authoritative in `development-plan.md`; this file decides **order, gates and verification**.

**Status:** `started` — see [`build-state.md`](./build-state.md) for the live ledger.

---

## 0. Operating rules (non-negotiable, self-imposed)

1. **Gate before code.** No product code beyond skeleton until spikes **S2** (does an out-of-tree client plugin boot?) and **S3** (does HyperFrames render a window deterministically?) have written answers. Both can invalidate a week of work.
2. **Every step ends with a verification command**, pasted into the ledger with its actual output. If I cannot write a verification for a step, the step is not specified well enough yet.
3. **I cannot see.** This model has no image input. Therefore: every visual claim is backed by (a) a numeric assertion (pixel statistics, geometry, SSIM against a golden PNG) or (b) a committed PNG the user looks at. I never write "the captions look good".
4. **Human checkpoints are scheduled, not improvised.** §7 lists them. They are cheap for the user (look at 3 images) and expensive for me to skip.
5. **Real footage early.** Fixtures prove mechanics; one of the user's real clips proves the product. I do not declare MVP without a real clip.
6. **One commit per step**, message = step id + verification result. `git log` is the build diary.
7. **Cheap model is the test target from day one.** Any tool design that only works if the model is clever is a design bug. The conformance harness (E3) runs `deepseek-v4-flash`, not pro.
8. **Never edit the DSH checkout.** Out-of-tree only; if a step seems to need an in-tree change, that is a finding to report, not a change to make.
9. **Clean as I go.** Generated artifacts live in `studio/.cache/`, `studio/out/`, `proofs/`; nothing pollutes the repo root.

---

## 1. Environment (measured, not assumed)

| Fact | Value | Consequence |
|---|---|---|
| CPU / RAM | Intel i7-3720QM, 8 threads, **8 GB** | **≤2 Chromium workers**; T0-first design; no 4K |
| Disk free | 154 GB | proxies + segment cache OK, needs a GC command |
| FFmpeg | 7.0.2 with libass, libx264, zoompan, overlay, sidechaincompress, loudnorm, VideoToolbox H.264 | T0 path fully available |
| Node / pnpm | 22.19.0 / 11.7.0 | matches DSH engines |
| Chrome | 156 | fine for HyperFrames capture |
| Docker | 29.8.2 | available for determinism pinning if needed |
| Python | 3.9.6 system, `uv` 0.8.22 | use `uv` for the face-detection env; do not touch system python |
| DSH | checkout at `~/Desktop/deepseek-harness`, no global `dsh` CLI, GUI on :3080 | invoke as `pnpm dsh` from the checkout, or install the CLI |
| ASR | no key in env yet | **blocker for B2** (Q15) |
| Whisper | not installed | deliberately not needed — hosted ASR is the default (ADR-013) |

Measured baseline to beat or match: **14.2 s** to render 4 segments of 24 s of 1080×1920 T0 output; **4.2 s** for a one-segment note round; **0.44 s** to reassemble 4 cached segments (`proofs/segment-cache/`).

---

## 2. Target shape (what I am building toward)

```
studio/                                  pnpm workspace — the product
  packages/
    core/            EDL schema · resolver · diff · layout solver · digest · wire types   (pure)
    presets/         8 text/visual presets · motion specs · rule validators              (pure)
    host-ingest/     probe · proxies · audio · ASR seam · silence · faces
    host-render/     renderer seam (ffmpeg | chromium) · segment cache · assembler · audio mix
    host-style/      rule engine · style memory · note→rule promotion
    host-qa/         deterministic lint · vision contact sheets
    host-server/     /video HTTP API · Range media route · SSE
    host-tools/      the ≤10 model-facing tools
    client-pane/     the Studio pane (one client bundle)
    bundle/          dsh.bundle manifest + cordis.patch.yml (the install surface)
    skill/           video-editing skill: SKILL.md + references
  scripts/           doctor.ts · ingest.ts · resolve.ts · render.ts · bench.ts
  fixtures/          project fixtures · fonts · golden frames
  vitest.config.ts   tsconfig.base.json   .cache/ (gitignored)
docs/               spec + reconstruction + this plan
proofs/             measured evidence, kept
```

---

## 3. Phase A — Foundation and gates

> Exit: the two riskiest unknowns are answered, a pane boots, and a file streams with Range. **Nothing else is built in this phase.**

### A0 — Workspace skeleton + `doctor`
- **Goal:** a workspace that typechecks, tests and can tell me what's broken.
- **Files:** `studio/{pnpm-workspace.yaml,package.json,tsconfig.base.json,vitest.config.ts}`, `studio/packages/core/src/{schema.ts,index.ts}`, `studio/scripts/doctor.ts`, `.gitignore` additions (`node_modules`, `.cache`, `out`, `*.mp4` outside `proofs/`).
- **Commands:** `cd studio && pnpm install`
- **Verify:** `pnpm -w typecheck && pnpm -w test` green with ≥1 real test (EDL schema round-trip); `pnpm doctor` prints ffmpeg/chrome/fonts/disk/asr-key/render-tier capability table and exits non-zero if ffmpeg or libass is missing.
- **Done when:** doctor's table is committed to the ledger.
- **Effort:** 30–40 min.

### A1 — **SPIKE S2 (GATE): an out-of-tree client plugin boots**
- **Question:** can a package built outside the DSH repo register a view in `conversation.view` and boot under `dsh web`?
- **Files:** `studio/packages/client-pane/{package.json,tsdown.client.ts,src/index.ts}` — a trivial component printing "Studio online" + the resolved session id; `studio/packages/bundle/{package.json,cordis.patch.yml}`.
- **Method:** reproduce the artifact contract from `packages/client/tsdown.client.ts:555-565` in the checkout — CJS closure factory (`window.__ModuleLoader__.load({id, factory})`), CSS injected at first `require` — then install the bundle into a fresh profile and boot.
- **Commands:** `dsh plugin --profile studio add ./studio/packages/bundle` → `dsh --profile studio --dump-config` → `dsh --profile studio web`
- **Verify:** (1) `--dump-config` shows our layer; (2) `curl -s localhost:<port>/ | grep -o 'client-pane'` shows the boot row; (3) the tab labelled **Studio** renders in the GUI and clicking it shows the component.
- **If it fails:** fall back in this order — (a) copy the in-tree preset verbatim and diff behavior, (b) in-tree package for the pane only, (c) `cordis_define` dynamic package for a throwaway prototype, (d) iframe a page served by our own `/video` route. Record which one and why in ADR-002.
- **Effort:** 1–2 h. **Timebox: 1 session.** If not solved in one session, take fallback (d) and move on; the pane is not allowed to block the pipeline.

### A2 — **SPIKE S3 (GATE): HyperFrames range render + determinism + speed**
- **Question:** does a window render seek on the absolute timeline, and what does it cost on this CPU?
- **Files:** `proofs/hyperframes/{comp.html,render-range.mjs,README.md}`.
- **Method:** one composition, 3 timed clips + one GSAP-animated caption group; render `[0,3s)` then `[6,9s)`; render the same range twice.
- **Verify:** (1) frame at window start matches the frame at the same absolute time of a full render (SSIM ≥0.99, or identical hash); (2) two runs of the same range are byte-identical (hash) or SSIM ≥0.999 with a documented reason; (3) throughput measured in output-seconds/minute and committed to the ledger.
- **RESULT (pass):** absolute-time ranges **confirmed** (SSIM 0.99989 vs 0.880 control), two runs **byte-identical**. `timebase:'absolute'` chosen — no per-segment re-basing.
- **Throughput (measured, 2 workers):** fixed overhead **≈13.6 s per Chromium render**, marginal **3.2 s per output second** at 540×960 and **5.9 s** at 1080×1920. A 60 s 1080p delivery render ≈ **6 min**.
- **Consequences now binding:** (a) T1 segments are batched into contiguous dirty runs and are coarse (≥8–12 s) — per-segment *Chromium* caching is an anti-pattern here; (b) T0 stays the default tier and is ~3.5× faster with no fixed cost; (c) NFR-04 relaxed to ≤8 min. Details: [`../proofs/hyperframes/README.md`](../proofs/hyperframes/README.md).
- **New follow-up S3b (not a gate):** can the browser/encoder be kept warm across renders (producer server, or one composition covering several dirty runs)? If it removes most of the 13.6 s, small T1 edits get ~4× cheaper. Worth half a session before D2.
- **Effort:** 1–2 h.

### A2b — **S3b (follow-up, not a gate): amortise the 13.6 s**
- **Question:** can one invocation render several disjoint dirty runs, or can the browser stay warm between runs?
- **Method:** three 3 s runs in one process vs three separate `hyperframes render` calls; then try `--workers 1` (less launch churn) and a single concatenated composition with gaps.
- **Verify:** wall time for 3×3 s disjoint runs; target ≤ 1.5× a single 3 s run instead of 3×.
- **Effort:** ≤2 h. If it fails, accept coarse T1 batching and move on — it is a performance nicety, not a correctness gate.

### A3 — Range media route
- **Goal:** `<video>` can scrub local files through our own host route.
- **Files:** `studio/packages/host-server/src/{routes/media.ts,ranges.ts}`, unit tests for the range parser.
- **Verify:** `curl -sI -H 'Range: bytes=100-999' 'localhost:<port>/video/media/fx/media/proxies/x/270p.mp4'` → `206`, `Content-Range: bytes 100-999/<size>`, `Accept-Ranges: bytes`; body length 900; `bytes=<size>-` → `416`; `../` traversal → `403`; a headless Chrome script seeks to 10 positions and reports `readyState`/`currentTime` accuracy.
- **Done when:** seek accuracy ≤50 ms and the traversal tests are red-then-green.
- **Effort:** 1 h.

### A4 — Spike S1: notes reach the agent
- **Question:** can a host plugin append a durable user message that starts a turn?
- **Files:** `studio/packages/host-server/src/{agent-bridge.ts}`, `scripts/spike-followup.ts`.
- **Verify:** script posts a synthetic review submission; the session log gains a `user/message` with our block, and the agent replies in the same session.
- **If it fails:** inject context and require one Enter from the user; document the extra click.
- **Effort:** 45 min.

---

## 4. Phase B — Media spine

> Exit: a real clip becomes a cached transcript, a silence map and a face track. **Inputs in, structured data out.**

### B1 — Probe, proxies, audio
- **Files:** `host-ingest/src/{probe.ts,proxy.ts,audio.ts}`, `scripts/ingest.ts`.
- **Verify:** on a real clip of the user's: 270p all-intra (`ffprobe` → `nb_frames`, every frame `key_frame=1` on first 30), 540p CFR with GOP 15 (`ffprobe -show_frames | grep key_frame` spacing), 16 kHz mono WAV; re-run is a no-op (mtime + hash unchanged, log says `cached`).
- **Effort:** 1 h.

### B2 — **ASR provider seam: OpenAI `whisper-1`** *(blocked: needs the key)*
- **Files:** `host-ingest/src/asr/{index.ts,openai.ts,local.ts}`, cache at `analysis/transcript.<src>.json`.
- **Interface:** `transcribe(audioPath, opts): Promise<Transcript>`; adapter owns upload/retry; result normalised to our `Word[]`.
- **OpenAI contract (locked):** `POST https://api.openai.com/v1/audio/transcriptions`, `model=whisper-1`, `response_format=verbose_json`, `timestamp_granularities[]=word` + `[]=segment`, `language` hint when known. 16 kHz mono WAV; chunk at silence boundaries if >25 MB. Word ids assigned deterministically from index so re-runs are stable. **Do not switch to `gpt-4o-transcribe` — it drops word timestamps.**
- **Verify:** on 3 clips (clean speech; speech over music; long pauses) → monotonic `startMs`, no word overlap beyond 60 ms, word count within ±5% of `ffprobe`-visible speech duration, `provider`/`model`/`costUsd` recorded, second run cached (0 network calls — assert with a request counter), and a **contract test against a recorded response fixture** so the adapter is testable without a key.
- **Effort:** 1–1.5 h.

### B3 — Silence map
- **Files:** `host-ingest/src/silence.ts`.
- **Verify:** on a clip with known pauses, detected regions cover ≥90% of hand-marked pauses (±120 ms edges); fixture snapshot committed.
- **Effort:** 45 min.

### B4 — Face tracks
- **Files:** `host-ingest/src/faces.ts`, `scripts/faces-env/` (uv-managed, YuNet ONNX), fallback `host-ingest/src/faces-null.ts`.
- **Verify:** on a portrait clip, a face is found in ≥90% of sampled frames; bboxes jitter-smoothed (median filter → ≤2 px frame-to-frame delta on a static shot); throughput ≥20 fps of sampled frames.
- **Effort:** 1.5 h. **If the ONNX path is painful, ship `faces-null` and gate the face-avoidance rules as `unverified`** — the resolver must degrade gracefully, so this is a legitimate cut, not a failure.

### B5 — Resolver: clip placement + word projection
- **Files:** `core/src/{resolve.ts,projection.ts}`, `fixtures/projects/fx-1/*`, golden snapshots.
- **Verify:** (1) golden snapshot of `Resolved` for the fixture; (2) property: every word whose midpoint lies inside a kept clip projects to the correct program frame (generated cases); (3) a cut word produces a `dangling-anchor` problem, never a silent drop; (4) speed: resolve 10-min timeline in <50 ms.
- **Effort:** 2 h.

---

## 5. Phase C — Edit model

### C1 — Ops, diff, dirty intervals
- **Files:** `core/src/{ops.ts,diff.ts}`, property tests.
- **Verify — this is the product's spine, so it gets the strictest tests:**
  - `applyOps` round-trip: `apply(invert(p))` ≡ identity (hash equality of EDL).
  - **Invariant 2 (dirty minimality)**: 500 generated patches, assert `renderedSegments(p) ⊆ segments(affectedSpan(p))`, zero exceptions.
  - No-op patch (setting an unused override) → `dirty.length === 0`.
- **Effort:** 2 h.

### C2 — Digest + token budget
- **Files:** `core/src/digest.ts`, snapshot tests.
- **Verify:** fixture digest matches committed snapshot **and** is ≤400 tokens (counted with the tokenizer used by the model adapter, not a word count); digest contains `PROBLEMS`, `DIRTY`, budget line.
- **Effort:** 1 h.

### C3 — Segment planner
- **Files:** `core/src/segments.ts`.
- **Verify:** boundaries land on proxy GOP boundaries; `minLen ≥1.5 s`, `maxLen ≤12 s`; transitions expand the dirty window by their duration; property test: segment set tile the timeline exactly, no gaps, no overlaps.
- **Effort:** 1 h.

---

## 6. Phase D — T0 renderer (the fast path)

### D1 — ASS caption generation
- **Files:** `host-render/src/ass.ts`, fixtures.
- **Verify (numeric — I cannot see it):** generated ASS parses (`ffmpeg -v info` shows no subtitle warnings); for a 30-page fixture, dialog count = page count; each page's `Start/End` matches the resolved frames ±1 frame; caption band luma `YMAX` in a burned frame exceeds the source's by ≥20 (the check I used in `proofs/segment-cache/`); horizontal extent of bright pixels stays inside title-safe.
- **Human checkpoint H2:** committed PNG of one burned frame for the user to glance at.
- **Effort:** 2 h.

### D2 — Segment renderer + assembly + manifest
- **Files:** `host-render/src/{ffmpeg-renderer.ts,segments-cache.ts,assemble.ts,manifest.ts,audio-mix.ts}`, `scripts/bench.ts`.
- **Verify:** (1) `bench.ts` reproduces or beats the 14.2 s / 4.2 s baseline on the same fixture; (2) untouched segment files are byte-identical across revisions; (3) concat output duration equals program duration ±1 frame; (4) loudness of the mix measures −14 LUFS ±0.5 with ≤−1 dBTP; (5) killing the job mid-render leaves completed segments and a resume costs ≈ the remaining segments only.
- **Effort:** 2–3 h. **This is the step the whole product promise rests on.**

### D3 — CLI end-to-end
- **Files:** `scripts/render.ts`.
- **Verify:** `pnpm render --project fx-1 --scope preview` produces `preview-rev1.mp4`; a second run reports `30/30 cached` and takes <2 s; `--note "change caption t-3"` style patch dirties exactly one segment.
- **Effort:** 45 min.

---

## 7. Phase E — Agent surface

### E1 — The five core tools
`video_project`, `video_analyze`, `video_edl_read`, `video_edl_patch`, `video_render`.
- **Verify:** (1) each tool's schema is registered and appears in the tool list; (2) `dryRun` on `edl_patch` returns the same diff as the CLI; (3) `video_render(dryRun)` returns cache hits/misses/eta matching `bench.ts`; (4) a background render returns a `jobId` and `job_output` streams progress; (5) sandbox policy: under `read-only`, render tools refuse with a structured error.
- **Effort:** 2 h.

### E2 — Skill bundle
`studio/packages/skill/{SKILL.md,references/*.md}` + install into `~/.dsh/skills/video-editing/`.
- **Verify:** skill appears in the catalog; `skill` loader returns our content; the six-call loop is spelled out exactly.

### E3 — **Cheap-model conformance harness**
- **Files:** `studio/scripts/conformance/{cases/*.json,run.ts}`.
- **Method:** for each case (fresh edit, apply 5 notes, add a rule, dry-run render, fix a lint finding), run the loop with `deepseek-v4-flash` and assert: tool sequence valid, no invalid-argument errors, final state passes lint, digest tokens under budget, turns ≤6.
- **Verify:** ≥90% of cases pass on flash; every failure is classified (spec defect vs model limit). **Spec defects get fixed in the spec/tool, not by switching to pro.**
- **Effort:** 2 h + iteration. This is where R4 stops being a guess.

### E4 — Notes → agent bridge
Wire `review.submit` to `agent.followup` (from A4), including the `<video_review>` block from `development-plan.md` §9.5.
- **Verify:** 5 notes in one submission produce exactly one user message, one agent turn, and 5 `noteIds` referenced by the resulting patch.

---

## 8. Phase F — The Studio pane (only after A1)

| Step | What | Verify |
|---|---|---|
| **F1** | Pane shell: `panel.state` fetch, `<video>` on the 270p proxy, program-time → source-time mapping, transport controls | Playhead matches frame index for 20 sampled positions (asserted in a jsdom test + manual spot check) |
| **F2** | Overlay compositing from the **same** CSS module + GSAP timelines the renderer uses | For 10 sampled frames, DOM geometry (box x/y/w/h) equals the resolved geometry scaled — asserted numerically, no eyeballing |
| **F3** | Timeline bands, segment states, notes rail, Send notes | Segmentation states come from SSE, not from a separate store; HMR dispose test passes |
| **F4** | **Timeboxed 3-hour experiment** (Q3 deferred — decide by using it): drag/resize overlays → relative patch → reconcile to solver; "verify this frame" stills | A 40 px drag produces one patch with `dxPx:40`, a new rev, and ≥1 stale segment — asserted in a jsdom test. **If the experiment does not feel good in 3 hours, cut it and ship F1–F3**; paste the finding into the ledger |
| **F5** | Lint badges on the timeline | A planted face-overlap shows a badge at the right frame |

**Human checkpoints:** H3 (pane plays + scrubs), H4 (drag a caption, it feels right), H5 (notes rail usable with 7 notes).

---

## 9. Phase G–H — quality, derivatives, delivery (v1.0 tail)

| Step | What | Verify |
|---|---|---|
| **G1** | `rules.json` + validators + fixtures | 13 validators, each with pass/fail/boundary fixtures; a planted violation in a fixture is caught with the right `ruleId` |
| **G2** | `stills` render + verify-frame | ≤2 s per still at 540p; PNG hash stable across runs |
| **G3** | `style_learn` + blast radius | Adding a rule reports exactly the items it would break, cross-checked against `video_lint` |
| **G4** | Vision QA contact sheets *(needs Q9)* | 20 frames → 1–3 JPEGs ≤2 MB; response validates against the findings schema; runs only when enabled |
| **H1** | Derivations + reframe | A 60 s window of a 16:9 fixture becomes a 9:16 output following the face track (bbox center within ±5% of frame center over the window) |
| **H2** | Deliver: MP4 + SRT + thumbnail + `delivery.json` | SRT cue count = caption page count; manifest hashes match files |
| **H3** | Batch: N projects, ≤4 in flight | 3 fixture sources → 3 outputs, per-project budgets respected, no job-admission overflow |

---

## 10. MVP definition of done

All of these, with the verification output pasted in the ledger:

- [ ] A real clip of the user's is transcribed by the hosted provider, cut, captioned, and preview-rendered **from the chat view only** (D1).
- [ ] The pane plays the preview, 7 notes are left, one Send produces one agent turn, and **≤3 segments re-render in under 60 s** (D2, D3).
- [ ] Dragging a caption in the pane commits a relative patch and a single-frame verify shows it (D4).
- [ ] `pnpm -w test` green, including the dirty-minimality property and the resolver goldens.
- [ ] `bench.ts` meets or beats the committed baseline on this machine.
- [ ] The flash-model conformance harness passes ≥90%.
- [ ] The ledger has zero `FAIL` entries.

---

## 11. Blockers I cannot work around

| # | Need | Blocks | Ask |
|---|---|---|---|
| B-1 | **ASR provider + API key** (Q15) | B2, and therefore everything downstream of a real transcript | "Which key do you have — ElevenLabs, Deepgram, Groq, OpenAI?" + put it in `~/.dsh/.credentials.yaml` or `.env` |
| B-2 | **One real clip** (any 30 s–5 min of your footage, ideally with a pause and a face) | Real-footage validation from B1 onward | Drop a file into `studio/fixtures/incoming/` or give a path |
| B-3 | **Fonts** for caption presets (Q2) | D1 typography; I will ship lookalikes until I have the real ones | Font files + a sample of your current caption style |
| B-4 | **Depth of pane interaction** (Q3) | F4 scope only — I proceed with drag-only | "drag overlays only in v1" — confirm or redirect |
| B-5 | **Vision QA consent** (Q9) | G4 only | One line: yes/no |
| B-6 | **Local DSH invocation** | Anything that boots the GUI | I will use `pnpm dsh` from the checkout unless you install the CLI globally |

---

## 12. What I do first, in this order

1. **A0** skeleton + doctor (30–40 min).
2. **A1** spike S2 — the one unknown that can change the architecture. Timeboxed to one session.
3. **A2** spike S3 — the other one.
4. **A3 + A4** — finish the transport and the agent bridge while the spikes are fresh.
5. Then announce: "gates clear, here is phase B" — because by then I will know whether the pane and the Chromium tier are real or whether the plan needs the fallbacks.

If A1 fails, I take fallback (d) (iframe served from our own route), which keeps D1–D3 and all of phases B–E intact and reduces the pane to a later polish item. **The pipeline is designed to be worth building even if the pane is temporarily degraded.**

---

## 13. Ledger discipline

`docs/build-state.md` holds one row per step: `step | state | verification (one line) | notes`. States: `todo · wip · pass · fail · blocked · cut`. I update it at the end of every session, and I never mark `pass` without pasting the command that proved it.
