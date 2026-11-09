# File contracts

These are strict. A malformed file fails the render with a validation error naming the field.

## `project.json`

```jsonc
{
  "schemaVersion": 1,
  "id": "prj_0e570872",
  "slug": "test-vid",
  "sources": [{ "id": "src-01", "durationMs": 480021, "width": 960, "height": 540, /* … */ }],
  "outputs": [{ "id": "vertical", "width": 1080, "height": 1920, "fps": 30 /* … */ }],
  "settings": {
    "captions": true,            // boolean, not "on"
    "captionStyle": "word",      // word | phrase | plain
    "font": "oswald",            // a key from the font library
    "voicePolish": true,
    "pace": "calm",              // calm | normal | fast
    "mumbles": "cut",            // cut | keep
    "orientation": "vertical",   // vertical | horizontal
    "background": "blur",        // none | blur | studio  (blur/studio need vertical)
    "graphics": "broll"          // none | broll
  },
  "window": { "fromMs": 222649, "toMs": 267931, "origin": "candidate" },
  "lastRender": { "file": "test-vid-render-….mp4", "label": "…", "at": "…", "captions": true, "settings": { … } }
}
```

`window` is in **source** time. `lastRender.settings` is what the displayed render was made with —
that is how the pane knows it is stale.

## `edit/cut-plan.json` — per-pause cutting

```json
{
  "schemaVersion": 1,
  "planner": "agent",
  "decisions": [
    { "srcMs": 295471, "retainMs": 320, "kind": "beat",
      "reason": "right after the claim 'Бог он очень слабый' — the pause is where it lands" },
    { "srcMs": 309536, "retainMs": 0, "kind": "stumble",
      "reason": "false start: 'я не знал ⟪⟫ он мог это сделать'" }
  ]
}
```

- `srcMs` — the pause **start** in source time, from the silence map.
- `retainMs` — milliseconds of the pause to KEEP. `0` is a hard jump cut.
- `kind` — `stumble | filler | breath | beat | unknown`. Only documentation and review, but write it.
- A pause with no decision falls back to the `pace` setting. Decisions that match nothing are inert,
  so a plan written for one window does nothing on another — **re-plan after changing the window**.

## `edit/graphics.json` — graphics track

```json
{
  "schemaVersion": 1,
  "graphics": [
    { "id": "g1", "kind": "text", "startMs": 800, "endMs": 5200,
      "layout": "lower-third", "motion": "fade", "text": "Свобода воли",
      "subtext": "фрагмент разговора", "accent": "&H0000FFFF" },

    { "id": "g2", "kind": "image", "startMs": 9000, "endMs": 16000,
      "layout": "inset-tr", "motion": "fade", "widthPct": 26,
      "src": "projects/<slug>/assets/card.png", "radiusPx": 16 },

    { "id": "g3", "kind": "video", "startMs": 20000, "endMs": 24000,
      "layout": "fullscreen", "motion": "none",
      "src": "projects/<slug>/assets/broll.mp4", "srcStartMs": 0 }
  ]
}
```

- **Times are PROGRAM time** (after pauses are removed), not source time. This is the one place that
  differs from notes and cut decisions.
- `layout`: `fullscreen | inset-tl | inset-tr | inset-bl | inset-br | lower-third`.
- `widthPct` — width of the inset as a percentage of the frame (5–100).
- `src` — path from the `studio/` directory, e.g. `projects/test-vid/assets/card.png`.
- `accent` — ASS colour `&HAABBGGRR`; `&H0000FFFF` is yellow.

## `edit/notes.jsonl` — one JSON object per line, append-only

```json
{"id":"n-0001","kind":"hide-captions","srcStartMs":319542,"srcEndMs":324288,"text":"let this breathe","createdAt":"…","status":"open"}
```

Kinds: `cut | hide-captions | text-card | image-inset | free`.
**Notes are SOURCE time.** The pane writes them; you normally read them, not author them.
`free` notes are instructions for you and are NOT applied by the renderer — act on them yourself.

## `edit/candidates.ai.json` — windows you propose

```json
{"schemaVersion":1,"generatedAt":"…","planner":"agent","candidates":[
  {"id":"ai-1","startMs":222649,"endMs":267931,"title":"God lost, the devil won",
   "rationale":"The most quotable passage: a 95/5 arithmetic ending on «идиотизм». Stands alone."}
]}
```

Boundaries must sit on pause edges (sentence boundaries) — a cut mid-word is the most obvious way an
automatic short feels machine-made. Snap to `analysis/silence.<src>.json` edges.
