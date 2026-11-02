# Build State — live ledger

One row per step. **A step is `pass` only when the verification command's output is pasted here.** States: `todo · wip · pass · fail · blocked · cut`.

Last updated: session 6 — **first end-to-end cut rendered and verified.** Proxies done (preview 1963.7 s, scrub 13.8 s), captions burned, output at `studio/out/test-vid-option2.mp4`.

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
| F3 timeline + notes rail | todo | — | checkpoint H5 |
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
