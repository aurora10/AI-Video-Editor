# The pipeline, command by command

All commands run from `studio/`. Every one prints what it did — quote those lines to the user.

## 1. Ingest

```sh
pnpm ingest fixtures/incoming/<file> --project <slug>
```

Slug is the project id you will use in every later command; derive it from the file name.

**Expect** (≈35–45 min for 8 minutes of 4K60 on this machine, because the 4K decode is the cost):

```
probe
  3840x2160 @ 60.04 fps · hevc · 2.71 GB
  480.0s · audio aac 2ch @48000Hz
  fingerprint …
proxies (master decoded exactly once, in cost order)
  audio                  cached
  …preview 20%  …preview 100%
  preview 540p          1963.7s
  scrub 270p            13.8s
artifacts
  scrub-270p     67.6 MB · 479.50s · 480x270 h264
  preview-540p   80.9 MB · 479.50s · 960x540 h264
  audio-48k      87.9 MB · 480.02s · a=48000Hz 2ch
record written: …/project.json
```

It is **idempotent**: re-running skips completed steps and says `cached`.

## 2. Transcribe

```sh
OPENAI_API_KEY must be in studio/.env
pnpm transcribe <slug>
```

**Expect**: `ok in 36.9s · 720 words · 96 segments · requests 1 · cost $0.048002`.
Language is auto-detected; on the reference clip it correctly identified Russian.

Then check the transcript actually holds up:

```sh
pnpm qa-transcript <slug>
```

Reads: word coverage of detected speech (want ≥ 90 %), words drifting into silence (want < 2 %),
contiguous-timestamp share (informational), script mix, longest words.

## 3. Propose windows (optional but usually right)

```sh
pnpm cut-plan <slug> --target 45 --count 4
```

Writes `edit/candidates.json` and prints each candidate with its opening words. These are ranked by
**speech density and sentence cleanliness** — not by meaning. If you can read the transcript
(`analysis/transcript.<src>.refined.json`), pick better windows yourself and write
`edit/candidates.ai.json` (format in `files.md`), saying why each stands alone.

## 4. Cut with judgement

Defaults already remove pauses and mumbles. To decide per pause, write `edit/cut-plan.json`: one
entry per detected pause, `retainMs` is how much of it to KEEP, `kind` is the editorial category
(`stumble` cut hard, `filler` cut, `breath` keep a little, `beat` KEEP — after a claim or a
question the silence is the emphasis).

Find the pauses and their surrounding words:

```sh
# pauses ≥250ms with the six words either side — this is what you decide from
# (run this as a small tsx script using detectSilence + the refined transcript)
```

## 5. Render

```sh
pnpm render-clip <slug> --label <name>
```

**Look flags are optional.** The renderer reads the project's own settings, so a bare render comes out
the way the user already asked for (orientation, background, font, pace, mumbles, graphics). Pass a
flag only when you are deliberately overriding that — and say so when you report.

A render you start this way **becomes the pane's current video**: the renderer records it in the
project record, so the user can watch what you just made. The exception is `--no-captions`, which
writes to `out/controls/` and never records anything (a control is not a deliverable).

Useful flags: `--from`/`--to` (accepts `m:ss` or seconds), `--captions word|phrase|none`,
`--graphics on|off`, `--pace calm|normal|fast`, `--fillers cut|keep`, `--no-voice-polish`,
`--orientation`, `--background`, `--font`, `--no-captions`.

**Expect** a progress stream and a summary:

```
  cut plan: 11 decisions by agent — filler 3 · beat 3 · stumble 3 · breath 2
  notes: 3 stored · 0 cut · 1 hide-captions · 1 graphics · 1 for the agent
  graphics: 4 item(s) (3 from edit/graphics.json, 1 from notes)
  faces: 180 samples · median chin 393px(source) · captions at y=592 · font Oswald 80px
  …encoding 20% … 90%
  ✔ out/<slug>-<label>.mp4
    540x960 · 55.30s · 4.1 MB · rendered in 42.9s
```

**How long it will take** — measured on this machine, not estimated: `wall ≈ 14 s + 0.5 × program
seconds` (8.1 s → 18 s · 55.3 s → 43 s · 104 s → 66 s). So a 2-minute passage is ~75 s, a 10-minute
one is ~5 min. Tell the user the estimate **before** starting anything longer than a couple of
minutes, and remember the pane's server kills a render at 15 minutes (~28 min of video).

Never render the whole source to let the user "review everything": render the window under review.
Preparation, not rendering, is what scales with the length of the file (4K60 on this machine:
0.24× realtime, so 8 minutes of footage is ~33 minutes of work).

## 6. Verify before you claim anything

```sh
pnpm verify-caption-placement <slug> out/<clip>.mp4 out/controls/<clip>-nocaps.mp4
pnpm verify-graphics <slug> out/<clip-with-graphics>.mp4 out/<clip-no-graphics>.mp4
pnpm measure-audio out/<clip>.mp4
pnpm doctor
```

`verify-caption-placement` needs a **settings-matched control** rendered with `--no-captions`;
it fails loudly if it could measure nothing, which is not the same as passing.

## 7. Graphics

Write `edit/graphics.json` (format in `files.md`): text cards, image insets from
`assets/`, or B-roll video clips, each with a program-time span, a layout and a motion.
For "generate some graphics and show me first": create the assets in `assets/`, tell the user the
file paths so they can look at them, and only place them once they approve.
