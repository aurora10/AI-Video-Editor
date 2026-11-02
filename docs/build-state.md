# Build State — live ledger

One row per step. **A step is `pass` only when the verification command's output is pasted here.** States: `todo · wip · pass · fail · blocked · cut`.

Last updated: session 1 — cleanup done, plan written, **A0 pass**.

## Gates

| Step | State | Verification | Notes |
|---|---|---|---|
| S0 segment-cache mechanism | **pass** | `proofs/segment-cache/`: 14.2 s cold vs 4.2 s incremental (3.37×), untouched segments sha256-identical, caption band YMAX 209→235 | pre-spike; ADR-005 evidence-backed |
| S1 `agent.followup` from host plugin | todo | — | A4 |
| S2 out-of-tree client bundle boots | todo | — | **A1 — architecture gate** |
| S3 HyperFrames range render + determinism | todo | — | **A2 — architecture gate** |
| S4 Range media route + scrub | todo | — | A3 |
| S5 hosted ASR adapter (word timestamps) | todo | — | B2 — **blocked: needs API key (B-1)** |

## Phase A — foundation

| Step | State | Verification | Notes |
|---|---|---|---|
| A0 workspace skeleton + `doctor` | **pass** | `pnpm -s typecheck` → exit 0 · `pnpm -s test` → **5/5 pass** (schema round-trip, invalid anchor, duplicate ids, min>max span, bad clip id) · `pnpm -s doctor` → *Hard requirements satisfied* (node 22.19, ffmpeg 7.0.2 + ass/subtitles/overlay/zoompan/sidechaincompress/loudnorm/silencedetect, libx264, VideoToolbox, Chrome 156, 376 system font faces, 154 GB free) | pnpm 11.7.0 + zod 3.24 installed; `esbuild` build script ignored by pnpm (harmless: tsx/vitest both run). Doctor warns on: no project fonts, no ASR key, no real footage, no global `dsh` CLI |
| A1 spike S2 | todo | — | timebox 1 session → fallback (d) if unsolved |
| A2 spike S3 | todo | — | decides `timebase` + whether motion presets are viable here |
| A3 media route | todo | — | `206`/`Content-Range`/`416`/traversal tests |
| A4 spike S1 | todo | — | — |

## Phase B — media spine

| Step | State | Verification | Notes |
|---|---|---|---|
| B1 probe/proxy/audio | todo | — | needs a real clip (B-2) |
| B2 ASR seam + adapter | **blocked** | — | Q15 / B-1 |
| B3 silence map | todo | — | — |
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
| F4 direct manipulation + stills | todo | — | checkpoint H4 |
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

## Human checkpoints (the user's eyes; I cannot see images)

| # | When | What to look at |
|---|---|---|
| H1 | after B5 | the resolved overlay geometry JSON for one fixture frame — does the description match the video |
| H2 | after D1 | one burned caption frame (`studio/.cache/checks/h2.png`) |
| H3 | after F1 | the pane plays and scrubs |
| H4 | after F4 | drag a caption; does it feel right |
| H5 | after F3 | leave 7 notes like the reference author did |
| H6 | MVP | the full D1–D4 demo on one of your real videos |

## Blockers

| # | Need | Blocks | Status |
|---|---|---|---|
| B-1 | ASR provider + key (Q15) | B2 and everything downstream of a real transcript | **open** |
| B-2 | one real clip in `studio/fixtures/incoming/` | B1 onward for real-footage validation | **open** |
| B-3 | caption fonts (Q2) | D1 typography | open (lookalikes until then) |
| B-4 | pane interaction depth (Q3) | F4 scope | open (proceeding drag-only) |
| B-5 | vision QA consent (Q9) | G4 | open |
| B-6 | preferred DSH invocation | GUI booting | open (using `pnpm dsh`) |
