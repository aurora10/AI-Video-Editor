# DSH Studio — Testing Guide

**What this tests:** the way you will actually work — drop footage in a folder, say what you want, look at the result, ask for the next layer.

**Not this:** clicking buttons. The buttons exist, and **T3** exercises them, but they are the secondary surface. The primary surface is the conversation with the agent, with the video as the thing you judge.

---

## How to read this

Every step has the same shape:

> **Say** — what you type in the chat
> **Expect** — what the agent does and what appears
> **Judge** — the question only you can answer

Fill in the boxes. The report template is at the end.

---

## 0. Setup (5 minutes)

### 0.1 Hard-reload the GUI

**`Cmd + Shift + R`** on http://127.0.0.1:3099. A stale bundle will make you report bugs that no longer exist.

### 0.2 Open a session and look at the Studio tab

Click the session in the left sidebar → the header shows **Chat · Trajectory · Studio** → click **Studio**.

You should see a vertical video with captions, a settings column on the right, and a timeline bar under the player. If you see all that, the machinery underneath is alive.

### 0.3 Two things to know before you start

**① Every shell command will ask for your approval.** On this machine macOS refuses to start the nested sandbox the agent normally uses, so each command needs a click. This is not the agent failing — it is the machine. Approve them; if it becomes unbearable, say so in your report (it is a strong argument for a fix).

**② The log box is the only sign a render is alive.** While it runs the button says **"Rendering…"** and the log counts up (`…encoding 20% … 90%`). If both are static, nothing is running.

### 0.4 What things cost (measured on this machine, not guessed)

Rendering is not one fixed time — it scales with how much video you render. Measured on the preview
path (540p from the cached proxy), three real renders:

| rendered passage | took |
|---|---|
| 8.1 s | 18 s |
| 55.3 s | 43 s |
| 104.1 s | 66 s |

Which fits closely to **≈14 s of fixed cost + half a second per second of video**. So:

| passage | predict | |
|---|---|---|
| 30 s | ~29 s | one reel beat |
| 1 min | ~44 s | |
| 2 min | ~75 s | |
| 5 min | ~2.8 min | |
| 10 min | ~5.3 min | a whole long-form blog |
| 20 min | ~10.3 min | at the server's 15-minute kill limit |

The first three rows are **measured**; below 2 minutes is extrapolation from the same line, so treat it
as a good estimate rather than a promise.

**The important consequence:** the pane renders **the window you are working on**, not the whole file.
So your iteration cost is set by the passage you are fixing, not by how long the video is. Editing a
20-minute interview in 60-second windows costs the same per iteration as editing a 1-minute clip.

**Preparation is the expensive part, and it does scale with the source.** Measured: 8 minutes of
4K60 phone footage took **33 minutes** to prepare (0.24× realtime — the decoder, not our code).

Why, and what to do about it. Decode-only, same 30 seconds of footage, on this machine:

| source | decodes at | 2 min source | 30 min source |
|---|---|---|---|
| **4K60 HEVC** (typical phone) | **0.29× realtime** | ~7 min | ~1 h 45 min |
| 4K60 H.264 | 2.9× realtime | ~40 s | ~10 min |
| 1080p60 HEVC | 6.3× realtime | ~20 s | ~5 min |
| **1080p60 H.264** | **10.9× realtime** | ~11 s | **~3 min** |

So the wait is not "your laptop is slow" in general — it is this 2012 chip having **no HEVC decoder in
silicon** (its hardware video engine only knows H.264, and VideoToolbox measured *slower* than software
here, so there is no hardware path to fall back on). Four times the pixels and a much harder codec,
decoded on the CPU, gives the ~37× spread above.

**The practical fix costs nothing:** export the clip as **1080p H.264** before dropping it in the folder
(on an iPhone: Settings → Camera → Formats → Most Compatible, then export from Photos at 1080p). A
30-minute source then prepares in about three minutes instead of two hours, and the edit loop — which
works from the 540p proxy — is unaffected. Keep the original 4K file for the final render.

Two caveats so this table is not over-read: my test variants were encoded at `ultrafast`, so real
camera H.264 decodes somewhat slower than the line above; and these are 30-second slices, while
preparation also scales and encodes its proxies (a further ~10–20 %).

**Preparation is paid once per file, not per edit** — the proxies are cached, which is why the edit
loop stays fast.

One thing that does **not** exist yet: the final 1080p render from the 4K master. That will be
decode-bound like preparation (~4× the program length), which is why it is on the list below rather
than in your test plan.

### 0.5 Choose your track

| Track | What it tests | Cost |
|---|---|---|
| **T1 — the layers** (start here) | captions, graphics, B-roll, notes, review on the **already-prepared** project | ~45 min, each iteration ≈45 s |
| **T2 — from raw footage** | the real first request: a new file, prepared and cut from scratch | +40 min for a long clip, ~5 min for a short one |

Do T1 first — it exercises everything except preparation, and it is fast. Then run T2 once to prove the beginning of the pipeline.

---

# T1 — The layers, on prepared footage

The project `test-vid` is already prepared, transcribed and analysed. That is deliberate: it lets you test the parts that involve *judgement and review* without waiting 40 minutes.

## T1.1 — "Let me see what you have" (2 min)

> **Say:** *"Show me the current state of the test-vid project and the latest render."*

**Expect:** the agent reports the window being edited (a source time range), the settings, how many notes exist, the path of the last render, and where the footage lives. It may mention which window the last render came from.

> **Judge:** was that summary accurate and readable? Did it tell you *where* the video is?

```
```

## T1.2 — "Remove the bad takes and silences" (10 min)

This is your first real request, on footage that is already cut. You are testing whether asking in plain language produces editorial work.

> **Say:** *"Cut the bad takes and the silences from the 3:42–4:27 window. Decide yourself how much of each pause to keep, and tell me what you decided."*

**Expect:**
1. Approval prompts for its commands — approve them
2. A render starts; the log box counts up
3. It reports back a **per-pause list with reasons**, e.g. *"cut hard on «я не знал ⟪⟫ он мог это сделать» (a false start), kept 320 ms after «Бог очень слабый»"*
4. A file path and a duration

> **Judge:** does the cutting feel like an editor made it? Which decision was wrong?
> *(The most useful answer names a moment: "it cut too early at 4:02".)*

```
```

## T1.3 — "It is too fast here" (5 min)

> **Say:** *"Between 4:05 and 4:20 it feels rushed. Give the pauses more room there and show me."*

**Expect:** it changes decisions only for those pauses, re-renders, and the passage breathes more. Total length grows slightly.

> **Judge:** did it change *only* that region, or did the whole cut shift?

```
```

## T1.4 — "Now let's put captions" (5 min)

> **Say:** *"Add captions — word by word — and tell me where they sit and how many there are."*

**Expect:** captions appear below your chin; the agent reports the page count, the style, and that it checked the captions clear your face.

> **Judge:** readable? sized right? positioned right? Is the word-by-word rhythm comfortable or too busy?

```
```

## T1.5 — "Generate some graphics, show me first" (10 min)

This is the step you asked for: **review the assets before they go in the video.**

> **Say:** *"Generate three motion-graphics ideas that would fit this argument — a title card, a stat card, and something for the 95/5 contrast. Put them in a folder I can look at; don't put them in the video yet."*

**Expect:** the agent creates image files under `projects/test-vid/assets/`, gives you the **paths**, and says what each is and where it would go. Nothing changes in the video yet.

> **Judge:** were the paths clickable/openable? Did the ideas fit the argument? Could you actually see them?

```
```

## T1.6 — "Put them in where appropriate" (10 min)

> **Say:** *"Use the stat card and the 95/5 one. Put them where they help the argument, not over my face."*

**Expect:** it writes placements (which second, which corner, how big), re-renders, and reports each placement with a reason. Images land **on the side away from your face**.

> **Judge:** were the placements good? Too big, too small, on screen too long, too short?

```
```

## T1.7 — "Insert B-roll as you see fit" (10 min)

> **Say:** *"Add B-roll where you think it helps. Use what is in the assets folder, or tell me what you are missing."*

**Expect:** either placements with reasoning, or an honest answer that the asset folder has no usable B-roll plus a list of what it needs. **Both are acceptable** — the second is the more likely outcome right now.

> **Judge:** if it improvised, was the timing right? If it asked, was the request specific enough to act on?

```
```

## T1.8 — Review in the pane and leave notes (10 min)

Now test the review loop itself, which is the reason the pane exists.

| # | Do this | Expect |
|---|---|---|
| 1 | Play the video; click the timeline bar at a moment you dislike | the video jumps there; a yellow playhead moves |
| 2 | Drag along the bar to select a few seconds | a blue selection appears, readout shows `selected 0:12.0–0:18.0` |
| 3 | Composer → **No captions** → **Add note for selection** | a row appears in the notes list; a render starts |
| 4 | Play that stretch in the result | captions gone **exactly there**, unchanged elsewhere |
| 5 | Composer → **Cut**, select a stumble, Add | the stretch is removed; the video shortens |
| 6 | Composer → **Instruction**, type *"make the captions bigger from here"*, Add | the note is stored but **nothing changes** — the renderer cannot act on free text, and the render log says `needs the agent` |

> **Judge:** was leaving a note faster and clearer than typing the same thing in chat? Step 6 especially — was it obvious that Instruction notes do nothing on their own?

```
```

## T1.9 — "Ask for a review" (5 min)

> **Say:** *"Watch the latest render and tell me what is weak about it."*

**Expect:** the agent reads the numbers (transcript, cut plan, notes, render log) and gives specific criticism, or admits it cannot see the frames. It should **not** invent impressions of the picture.

> **Judge:** was the criticism specific and useful, or generic? Did it pretend to have watched?

```
```

---

# T2 — From raw footage (the real first day)

Run this once. It is slow because 4K takes ~40 minutes to prepare — that is the honest cost of this machine.

## T2.1 — Put the file where the system expects it

Drop a raw video into:

```
studio/fixtures/incoming/
```

**Use a short clip** if you have one, and export it as 1080p H.264 (see §0.4): a 1-minute 4K60 HEVC
clip costs ~4 minutes of preparation, a 3-minute one ~12 minutes, but the same clips as 1080p H.264
cost well under a minute each.

## T2.2 — The first real request

> **Say:** *"There is a new video in the incoming folder. Prepare it and remove the bad takes and the silences. Tell me what you find before you cut anything."*

**Expect, in this order:**
1. It lists the folder and confirms which file (it should ask if there is more than one)
2. It starts preparing: probe numbers appear (`3840x2160 @ 60 fps · hevc · 2.71 GB`), then `…preview 20% … 100%`, then the scrub proxy, then `record written`
3. It transcribes and reports word count, segment count, cost, and detected language
4. It reports what it found: how many pauses, how much dead air, any stumbles
5. **Only then** does it propose a cut and render

> **Judge:** did it talk to you *before* cutting, as asked? Did the numbers make sense — dead air %, language, word count?

```
```

## T2.3 — The acceptance question

> **Judge:** watch the result. **Would you have paid an editor for this cut?**
> If not, name the single worst moment. That one sentence is the most valuable thing in your report.

```
```

## T2.4 — The second layer, on the new project

> **Say:** *"I like it. Now put captions on it."*

**Expect:** the same caption behaviour as T1.4, on the new footage — which proves the pipeline is general, not tuned to one clip.

```
```

---

# T3 — The buttons (secondary, 15 min)

Every control has a tested backend; this is a smoke test that the UI honours it. **Auto-render is on**, so each click starts a render — wait for it, or the next click queues.

| # | Click | Expect |
|---|---|---|
| 1 | **Caption style → Phrase, active word highlighted** | whole phrase stays; the spoken word turns yellow and grows slightly |
| 2 | **Caption style → One word at a time** | one word, larger |
| 3 | **Font → Bebas Neue**, then **Montserrat** | visibly different faces, caption size unchanged |
| 4 | **Sound → Raw audio**, listen | thinner, duller than before |
| 5 | **Mumbles → Keep everything**, then back | slightly longer and rougher, then tighter again |
| 6 | **Format → Horizontal 16:9** | frame becomes wide; a blue line explains the background was reset |
| 7 | **Background → Blurred background** (while horizontal) | refused with the reason; it does not silently do nothing |
| 8 | **Format → Vertical 9:16** + **Background → Studio look** | full frame fitted over a blurred copy, slightly vignetted |
| 9 | **Window → a grey time button**, then **a gold ★ button** | the window changes instantly, a render starts, the video becomes that passage |
| 10 | **Suggest windows with AI** | the agent proposes windows; ★ buttons appear (approvals required) |
| 11 | **Plan cuts with AI** | the agent rewrites the cut plan for the current window and re-renders |

> **Judge:** which of these felt like a real editor's control, and which felt like a debug switch?

```
```

---

## What NOT to report as a bug

| Known limitation | What you will see |
|---|---|
| **No final quality** | everything is a **540p preview**. No 1080p export, no SRT, no thumbnail, no upload |
| **No trim-by-drag** | you pick a window; you do not drag in/out points |
| **Graphics placement is fixed** | image notes: 32 % width, on the side away from your face, top corner. No size slider, no drag |
| **No B-roll library** | you can point at files in `assets/`; there is no search or tagging |
| **Instruction notes don't act** | they are stored for the agent, not applied by the renderer |
| **Approval per command** | the macOS sandbox cannot start here; every command needs a click |
| **Cut judgement is audio-only** | it hears stumbles and beats; it cannot tell whether a cut *looks* jumpy mid-gesture |
| **Window suggestions are text-only** | the agent reads the transcript; it has not seen the frames |
| **One video at a time** | no batch, no "three shorts from one long video" |
| **One window at a time** | the pane edits a chosen passage. There is no "render the whole 20-minute interview in one file" control yet — and the server kills any render at 15 minutes, which is ~28 minutes of video |
| **Long-form has never been tested end to end** | only 45–105 s passages have actually been rendered. The multi-window path exists on paper, not in evidence |

---

## Report template

```
## Which track(s) I ran
T1 / T2 / T3 (delete what does not apply)

## The conversation
- Did the agent understand plain-language requests? where did it guess wrong?
- Did it talk before acting when I asked it to?
- Did it explain what it decided — readable, or jargon?

## The output (judge this, not the app)
- T1.2 the cut:
- T1.3 after "too fast here":
- T1.4 captions:
- T1.5 graphics I was shown:
- T1.6 graphics in the video:
- T1.7 B-roll:
- T1.9 the review it gave:
- T2.3 would I pay for this cut?

## What broke
step | what I expected | what happened

## What I wanted to say and could not
(the most useful section — your own words)

## Speed and friction
- how annoying were the approval prompts? (1 = fine, 5 = unusable)
- was ~45 s per iteration on this preview path acceptable? what would you accept for a 2-minute window (~75 s)?
```

---

## Timing summary

| | |
|---|---|
| T1 layers | ~45 min (≈45 s per re-render) |
| T2 from raw | ~50 min (≈5 min preparation for a short clip) |
| T3 buttons | ~15 min |
| **Total** | **under two hours** |

Split it: T1 in one sitting, T2 in another.
