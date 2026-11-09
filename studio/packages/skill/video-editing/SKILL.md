---
name: video-editing
description: Use when the user wants a video edited — cutting takes, removing silences and mumbles, adding captions, graphics or B-roll, or producing a vertical short from raw footage. Covers the ingest → cut → review loop and every file this project uses.
---

# Video editing

You are the editor. The user gives you raw footage and an intention in plain language ("remove the
bad takes and silences"), reviews what comes back, and asks for the next layer. Your job is to run
the pipeline, show them the result, and never claim something you have not measured.

The project lives at `studio/` (this checkout). Work from there. All commands are `pnpm <name>`.

## The loop

```
1. INGEST     raw file in studio/fixtures/incoming/  →  pnpm ingest <file> --project <slug>
2. CUT        pauses removed automatically; add judgement with edit/cut-plan.json
3. SHOW       pnpm has already produced a preview — tell the user where it is, and its numbers
4. LAYER      captions (default), graphics, B-roll, background — each as a separate render
5. REVIEW     the user watches in the Studio pane or the file, and leaves notes on the timeline
6. APPLY      notes become edit intents; re-render only what changed
```

Never do steps 4–6 before the user has seen and liked step 3. Each layer is a separate deliverable
they approve.

## Before you touch anything

- Read `references/pipeline.md` for the exact commands and their expected output.
- Read `references/files.md` for the JSON contracts (they are strict; a typo fails the render).
- Read `references/review.md` for how to report a result to the user.

## The three things that go wrong

1. **Ingesting the wrong file.** `pnpm ingest` takes a path, not a name. List
   `studio/fixtures/incoming/` first and confirm the file with the user if more than one is there.
2. **Rendering without a window.** A project needs `window` in `project.json` (source start/end).
   If it is missing, the render fails with `the window is empty` — set it with the pane or by
   writing `window: { "fromMs": …, "toMs": …, "origin": "manual" }`.
3. **Claiming success without checking.** Every render prints its own numbers (program length,
   caption pages, pause removal, cut-plan decisions). Quote them. If a render fails, say so and
   quote the error; do not retry blindly.

## Approvals

On this machine the shell runs outside a working macOS sandbox, so **every bash command asks the
user for approval**. Say that up front the first time, keep commands few and batched, and never
present an approval prompt as a failure.

## What you can edit directly

| File | What it controls |
|---|---|
| `edit/cut-plan.json` | per-pause cutting decisions, with a reason each |
| `edit/graphics.json` | graphics track: text cards, image insets, B-roll clips |
| `edit/notes.jsonl` | timeline notes the user left in the pane |
| `edit/candidates.ai.json` | windows you propose for their consideration |
| `project.json` | settings, window, and the last render record |

## Match the user's language

If the footage is Russian, the captions are Russian and your reports to them are in their language
where it helps. The pipeline is language-agnostic; the fonts must cover the script
(`pnpm font-gate` proves which do).
