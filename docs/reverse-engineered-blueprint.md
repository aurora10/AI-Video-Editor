# Reverse-Engineered Blueprint — "Replacing My Editor With AI"

**What this is:** the reference video takes a working system apart on camera while using it. This document reconstructs that system as *buildable artifacts* — the exact prompt, the style file, the template set, the review-app contract, the run order — with a transcript line reference for every claim, followed by an honest register of what the video never shows.

**Method:** every statement is tagged with its evidence (`L###` = line in `reference/transcript2.txt`) and a confidence level. Where the video is silent, it is marked `GAP-n` and *not* filled in with a guess.

Confidence: **[H]** stated explicitly on camera · **[M]** strongly implied by demonstrated behaviour · **[L]** inferred from adjacent evidence.

---

## 1. The system, in one picture

```
        ┌─────────────────────────────────────────────────────────────┐
        │  AGENT RUNTIME: Claude desktop app → "Code" tab (not Chat)  │ L182-311 [H]
        │  model: Opus High · new session per video · file dragged in │ L325-337 [H]
        └───────────────┬─────────────────────────────────────────────┘
                        │ reads on demand
        ┌───────────────▼──────────────┐   ┌────────────────────────────┐
        │ SKILL: rules + guidelines    │   │ TEMPLATES: 20+ style packs │
        │ "follow every single time"   │   │ reels/explainer/clips/...  │ L201-230 [H], L232-281 [H]
        └───────────────┬──────────────┘   └────────────┬───────────────┘
                        │                               │
        ┌───────────────▼───────────────────────────────▼─────────────┐
        │ TOOLCHAIN (installed once via Homebrew + Node + Python)     │ L189-203 [H]
        │  ElevenLabs → word-level transcript  ($0.22/hr)             │ L84-92  [H]
        │  HyperFrames → animations, text, graphics, captions         │ L93-95  [H]
        │  FFmpeg → cutting, assembly, encoding                       │ L95     [H]
        └───────────────┬─────────────────────────────────────────────┘
                        │
        ┌───────────────▼─────────────────────────────────────────────┐
        │ 720p PROXY RENDER  ("so I can leave notes")                 │ L166-169 [H]
        └───────────────┬─────────────────────────────────────────────┘
                        │
        ┌───────────────▼─────────────────────────────────────────────┐
        │ REVIEW APP in the browser, "almost like Frame.io"           │ L361-363 [H]
        │  play · notes at exact second · save note · send notes      │ L373-505 [H]
        │  approve & final render → 1080p                             │ L563-564 [H]
        └───────────────┬─────────────────────────────────────────────┘
                        │ "save it to the skill"
                        ▼ feedback closes the loop back into SKILL
```

Five components, and *only the fifth* is novel. Everything else is a stock coding-agent workflow: a rules file, a template library, shell tools, and a review surface.

---

## 2. Artifact A — the prompt he actually types

Reconstructed from L341–350 and L156–165 **[H for content, M for exact wording]**:

```text
[drag mp4 into the session]
Edit this video using my personal reel style. I want the captions.
```

The skill is reached two ways, both demonstrated:

| Path | Evidence | Note |
|---|---|---|
| Semantic match — the prompt is matched against installed skills | "it will take my prompt find the relevant skills" (L345–346) | **[H]** |
| Explicit slash command — `/personal` → "personal short form" | "I could also just type the slash command and type in personal" (L347–350) | **[H]** |

**Design consequence:** a skill needs a *short, unambiguous trigger phrase* and an alias that is one slash-command token away. Our `video-editing` skill does the same: description carries "edit this video", project style skills are named `<brand>-reel` so `/reel` resolves.

---

## 3. Artifact B — the skill file (reconstructed)

He describes "a list of rules and guidelines that it's going to follow every single time" (L201–208) and reads fragments aloud. Every rule he names, with the check it implies:

| # | Rule as stated | Evidence | Implied check | Machine-checkable? |
|---|---|---|---|---|
| 1 | "cut every pause" | L207 | silence regions > threshold → removed | **yes** (VAD map) |
| 2 | "every fail take" | L207–208 | repeated take starts → keep best | partly (needs judgment) |
| 3 | "cut throat-clearing / looking around" | L292–294, L293 | audio event + silence | **yes** |
| 4 | "caption, one line, just under my chin" | L209 | max 1 line, anchor = below chin | **yes** (geometry) |
| 5 | "text never covers my face" | L217 | text box ∩ face bbox = ∅ | **yes** (needs face track) |
| 6 | "music 25 decibels under my voice" | L210–211 | measured gain delta | **yes** |
| 7 | "big font stays on screen long enough — add a hang" | L420–430 | min on-screen ms + lead-in | **yes** |
| 8 | "no captions during full-screen animations" | L394–399 | item-kind overlap | **yes** |
| 9 | "B-roll goes where my finger points, smaller, can touch my head, not my eyes" | L378–389 | region + face-safe placement | **yes** (with a region target) |
| 10 | "text never covers face" (repeated as a different note) | L389 | duplicate of #5 | — |
| 11 | "keep the slight rotation" | L385 | preserve authored rotation | **yes** |
| 12 | "move text a bit lower → move the emoji lower too" | L460–464 | linked layers move together | **yes** (group) |

**The structural finding:** rules 1–12 are stated as English prose and stored in a prose skill file. Nine of the twelve are *mechanically verifiable* but nothing in his stack verifies them — the only enforcement is that Claude re-reads the file each session and mostly complies **[M]**. Rule 9 is the tell: he asks for face-safe placement by *describing it*, and the same mistake recurs because the system has no face geometry.

That is exactly the gap `rules.json` + validators closes in our design ([`development-plan.md`](./development-plan.md) §6.6).

---

## 4. Artifact C — the template library

Named on camera (L252–268) **[H]**; structural content inferred **[M]**:

| Template | Implied structure |
|---|---|
| Business reels · personal reels · explainer reels | one talking head + text emphasis; differ in typography/colour/pacing |
| Coaching clips · YouTube clips | "take your YouTube videos and Claude will clip them, find the best part" (L255–259) → **long→short extraction** with hook selection |
| Split screen reel | subject top / graphics or screen recording bottom (L260–263) |
| B-roll + stack text | B-roll library lookup + stacked text over it (L263–267) |
| Fitted captions | captions sized to a safe width, not a fixed font size |
| Image cluster | multiple images tiled as a group |
| *(his words)* "there's just so much" | 20 shipped, 30 more promised (L246–250, L273–274) |

**Design consequence:** a template is not a look — it is a *layout policy + B-roll policy + caption preset + motion set*. Our `presets` package models exactly those four fields (`§8.2`), and the long→short extraction is a first-class `Derivation` ([`development-plan.md`](./development-plan.md) `§6.4`) rather than a prompt instruction.

---

## 5. Artifact D — the review app contract

Reconstructed from L360–505 **[H for behaviour, L for data shape]**:

| Capability | Evidence |
|---|---|
| Plays the 720p render | L360–364 |
| Note is created at the *current playhead second* | L369–374 |
| Note is free text, dictated | L376–390 |
| "Save note" adds it to a list; the video keeps playing | L390–392 |
| Multiple notes accumulate (he ends with **7**) | L479 |
| "Send notes to Claude" (or copy-select-all) | L491–505 |
| "Approve and final render" | L563–564 |
| Agent reports completion back into the session | L498–500 ("Running command… It's woke") |

Minimal data shape this implies:

```json
{ "id": "n-3", "tSec": 14.2, "text": "the b-roll should be smaller and sit where my finger is pointing…",
  "savedAt": "…", "status": "open" }
```

**What is absent — and this is the important part:** no target reference (which clip/graphic/text the note is about), no camera-region box, no state machine (open/applied/rejected), no link to the revision that was reviewed, no reviewer identity, no thread/reply. He compensates with *prose density* ("where my finger is pointing, above my head, slightly rotated is fine") because the system gives him no other handle. Our `Note` model ([`development-plan.md`](./development-plan.md) `§6.5`) adds `targets[]`, `region`, `rev`, `appliedInRev` — the same note becomes ~3× cheaper to act on and answerable later.

---

## 6. Artifact E — the run order, and who decides each step

Reconstructed from L155–175 plus the demonstrations **[H]**:

| # | Step | Decided by | Our substitution |
|---|---|---|---|
| 1 | Drag file in; new session | human | `video_project` tool |
| 2 | Transcribe (word-level) | tool | same, local (`video_analyze`) |
| 3 | Cut pauses / fail takes / throat clears | **model judgment on transcript** | deterministic silence map + model for take selection |
| 4 | Captions (word-timed, one line, under chin) | template + model | preset + **layout solver** |
| 5 | Text/graphics per template | template + model | preset + HyperFrames composition per segment |
| 6 | B-roll selection & placement | **model, from a library** | asset library search + solver + region targets |
| 7 | Animations | template | motion presets (GSAP) |
| 8 | Sound effects + music + ducking | template + skill rule | audio bus with measured ducking |
| 9 | 720p proxy render **for review** | tool | `video_render preview` (540p) |
| 10 | Human review → notes → re-run | human + model | pane + `review.submit` → dirty-segment re-render |
| 11 | 1080p final; AirDrop/Drive | human approval | `video_deliver` + manifest |

Wall-clock evidence: 30 minutes for one 45s short including his idle scrolling (L354), and 2.5–3 hours for a batch of seven (L577–580).

---

## 7. The economics, re-derived

His figures **[H]**, re-derived per unit of output:

| | Human editor | His AI stack |
|---|---|---|
| Short-form, per video | $30–50 typical, $150 premium | ~$3.00 (L103–106) |
| Long-form, per video | $150–500 | ~$3.00 |
| Monthly, 30 shorts + 4 long | **$2,100** (L118–128) | **$100** (+$200 tier optional) |
| Ceiling | editor's capacity, 3–7 day turnaround | 22% of a weekly quota for 16 shorts (L107–116) |
| Human time | 0 (but 3–7 day wait + revision rounds) | **review attention only** — 2 watch-throughs, 7 notes |

**The line nobody reads twice** (L166–170): *"it will render a 720p version so I can leave notes inside an editing review app."* The proxy exists so a **human can afford to review**. The AI's cost is trivial; the human's attention is the whole budget. Which is why our design optimises *note-round latency* (NFR-01), not token cost.

---

## 8. Field notes — the four corrections he made on camera (the most valuable data in the video)

Each one is a missing specification, discovered by a human watching:

| # | His note (verbatim-ish) | What is missing in his system | What our spec must encode |
|---|---|---|---|
| 1 | "I was pointing here, but it didn't put it where my finger was pointing" (L369–373) | No region/camera geometry — the model infers placement from prose | `Note.region` + `BoxHints.anchor: 'beside-subject'` + face track |
| 2 | "when you've done full screen animations like this, don't add any captions" (L394–399) | No interaction rule between item kinds | Rule `caption-none-on-fullscreen` (validator) |
| 3 | "the big font doesn't stay on screen long enough… make sure there's a little hang" (L420–430) | No minimum on-screen duration policy | Rule `caption-min-on-screen {minMs, leadInMs}` applied by the resolver |
| 4 | "increase the music instrumental by two decibels" (L489) | Ducking is a fixed offset, not a measured target | Measured `music-under-voice` with `targetDeltaDb` and a lint check |

These four are why the design puts a **rule engine and a geometry solver** between the model and the pixels. Every one of them is a thing a human had to notice because the system had no way to notice it.

---

## 9. Gap register — what the video does not reveal

Listed so nobody mistakes reconstruction for knowledge.

| # | Unknown | Impact |
|---|---|---|
| GAP-1 | **What the review app actually is** — his own tool, a Claude artifact, or an npm package? He only says it "opens in the browser plane… almost like Frame.io" (L361–363) | High: it is the single most novel component |
| GAP-2 | The skill file's literal text and format (`.md`? a Claude skill package? `.claude/skills/`?) | Medium |
| GAP-3 | How cuts are decided: silence threshold, transcript heuristics, or pure model judgment | High: determines whether a cheap model can do it |
| GAP-4 | Whether re-renders are **incremental**. Everything shown is consistent with a full re-render per round; nothing suggests segment caching | High: this is exactly what we add |
| GAP-5 | How B-roll is selected from the library (tags? embeddings? filenames?) and where the library lives | Medium |
| GAP-6 | Whether caption timing is word-anchored or baked numbers (the "hang" fix suggests baked) | High |
| GAP-7 | How many agent turns and note rounds a typical video takes (he stops after one round: "I'm not going to go back and forth", L511–514) | Medium |
| GAP-8 | Model and effort: "Opus High" (L326–327) — no cheaper-model comparison is shown | Medium: our whole cost thesis |
| GAP-9 | Template internals and licensing; the "template pack" is a paid product (L439–443) | Medium |
| GAP-10 | Failure recovery: what happens when the agent breaks a render or loses an edit | High |
| GAP-11 | Batch mechanics: "I did eight at once" (L314–318) with subagents per video (L571–580), but no detail on contention, cost, or failure isolation | Medium |
| GAP-12 | Music/SFX provenance and licensing | Medium |
| GAP-13 | What "the Depth UI editing template" is (L476) — an animation reference we cannot inspect | Low |
| GAP-14 | Whether notes persist across *videos* (he claims the skill generalises, L227–230) | High: this is the "taste memory" claim |
| GAP-15 | Anything about determinism, colour management, or audio loudness targets | Medium |
| GAP-16 | Whether he has tried a cheaper model ("I've switched from the $100 plan to the $200 plan" — L327–330 is about quota, not model choice) | High |
| GAP-17 | How the "Approve & final render" button communicates to the agent (L563–564) | Low |

**What this means in practice:** we can clone the *loop* with high confidence (the loop is fully demonstrated), and we can clone the *artifacts* in shape but not in content. The unobservable parts — the exact skill text, the exact templates, the review app's implementation — are precisely where the reference's quality comes from, which is why our spec replaces "prose + vibes" with rules, geometry and golden tests rather than trying to guess his file contents.

---

## 10. Faithful clone vs. deliberate improvement

| Aspect | Reproduce as-is | Improve | Why |
|---|---|---|---|
| The director's loop | ✅ identical stages | — | It works; changing the UX would break what people recognise |
| 720p-before-1080p | ✅ (as 540p/1080p) | — | Latency-first review is correct |
| Style learned from notes | ✅ concept | ✅ make it executable | His enforcement is probabilistic |
| 20+ templates | ⚠️ 8 good ones in v1 | ✅ quality per template | Golden frames + inspector per preset |
| Transcript | ✅ word-level | ✅ local by default | Privacy + $0.22/hr savings |
| Notes | ✅ timestamped free text | ✅ targets, regions, states, revision binding | Removes the guessing step |
| Re-render on note | ❌ full re-render | ✅ dirty-segment only | 3–20× faster rounds |
| Model | ❌ one expensive model | ✅ flash/pro/vision routing | ~10× cost reduction on the mechanical 80% |
| Review surface | ❌ unknown third-party app | ✅ native DSH pane | Notes live in the session, not in a side system |

---

## 11. Measured validation of the reconstruction

The reconstruction's central claim — *"you can edit one piece without re-rendering the whole video"* — was verified end to end on this machine with a throwaway benchmark (`../proofs/segment-cache/build.mjs`): a 30s 1080×1920 synthetic source, three pauses cut, four segments, ASS captions burned, then one caption note applied to a single segment.

| Measurement | Result |
|---|---|
| Cold render, 4 segments + concat | **14.2 s** (24s program) |
| One-note round, 1 dirty segment + concat | **4.2 s** |
| Speedup on that note round | **3.37×** |
| Untouched segments | byte-identical across revisions (sha256 match) |
| Caption burn verified | caption-band luma YMAX 209 → 235 |

The 3.37× is the *pessimistic* case: 4 segments over 24s means one note dirties 25% of the timeline. At the segment granularity the spec targets (1.5–6 s per segment → 12–15 segments for a 60s short), a one-note round dirties ~7% and the ratio rises to ~10×, bounded by concat overhead.

---

## 12. Bottom line

**Did I reverse-engineer it?** Yes: the loop, the prompt, the skill *rules* (12 of them, with the check each implies), the template taxonomy, the review-app contract, the run order and the economics are reconstructed above with line-level evidence. The honest limit is §9 — 17 things the video cannot tell us, four of which (GAP-1, GAP-4, GAP-6, GAP-14) would change the design if guessed wrong.

**Can it be built?** The loop has already been built by him, so existence is proven in the Claude ecosystem. The question is whether it can be built *on DSH with a cheap model*, which is an engineering question about three things, and all three now have answers:

| Question | Answer |
|---|---|
| Can an out-of-tree pane take a real seat in the harness UI? | **Yes** — gate S2: the Studio tab registers, mounts and renders (`docs/build-state.md`) |
| Can a *piece* of the timeline be re-rendered without the whole video? | **Yes, two ways** — T0 segments: 14.2 s → 4.2 s (3.4×); Chromium windows render on absolute time (SSIM 0.9999, deterministic) |
| Is the cheap model constrained enough to drive it? | **Open** — the digest-based tool surface is designed for it; the flash-model conformance harness (E3) is the test, and it has not run yet |

The one thing the measurements changed: Chromium rendering costs **≈13.6 s of fixed overhead per invocation** on this machine, so graphic work is batched into contiguous runs rather than split into many small segments — while caption/layout work stays on the FFmpeg path, which has no fixed cost and runs ~3.5× faster.
