# DSH Studio — Testing Guide

## What this is, in plain words

It is **two things side by side**.

In the conversation you type what you want in normal language — *"cut the bad takes out of this, the
pauses too"* — and an AI assistant does it and tells you what it decided.

In the **Studio** tab next to the conversation is a video editor: the video you are working on, a
settings column, and a bar under the player you can click and drag. You watch what the AI made. If you
don't like it, you say so and it tries again.

You never have to learn a video editing program. You watch the result and say what's wrong with it. That
is the whole idea being tested: **can a person who does not edit video get a video edited by explaining
what they want.**

## What you are not testing

Clicking buttons is the *small* part. The buttons exist and are tested (T3), but the product is the
conversation: you say something, a video comes back, you judge it.

---

# Part 0 — Day one: getting it running (10 minutes)

Do these in order. Nothing here needs technical knowledge except one line copied into a terminal.

## 0.1 Start the server

1. Open **Terminal** (`Cmd + Space`, type `terminal`, Enter).
2. Type these two lines, pressing Enter after each:

   ```
   cd "/Users/albert/Desktop/CodeWork/Video Editor AI/studio"
   ./start.sh
   ```

   *If typing that path is awkward:* type `cd ` (with a trailing space), drag the `studio` folder from
   Finder into the Terminal window, then press Enter.

3. You will see a few lines, then:

   ```
   harness:  /Users/albert/Desktop/deepseek-harness
   profile:  studio
   home:     …/studio/.dsh-home

   starting… this takes about 10 seconds.
   ```

   Then log lines scroll past — normal. **Leave this window open.** Closing it stops the server.

4. If it prints `Already running — nothing to start.`, the server was already up. Go to 0.2.

**The very first time on a new machine** the first line says `first run: preparing the studio
profile… done` — a one-time setup that takes about a minute.

## 0.2 Open the page

In Chrome, go to:

```
http://127.0.0.1:3099
```

Press **`Cmd + Shift + R`** — a *hard* reload. Without it you may be looking at an old copy of the page
and reporting problems that were already fixed.

You should see a chat window: a sidebar of sessions on the left, and a message box at the bottom saying
*"Describe what you want to build"*.

## 0.3 Start a conversation

1. Click **New session** (top of the sidebar).
2. Type anything in the box — *"hello"* is enough the first time — and press **Enter**.

The AI replies. Now look above the conversation: three tabs — **Chat · Trajectory · Studio**.

> **The Studio tab only appears inside an open conversation.** On the session list it is gone. That is
> not a bug; the editor belongs next to the video's conversation.

## 0.4 Click Studio — this is the editor

The right side fills with the editor. Top to bottom:

| What you see | What it is |
|---|---|
| **WINDOW — WHICH PART OF THE FOOTAGE** | which piece of the source video you are editing. Useful when the source is a 40-minute recording and you want a 60-second piece out of it |
| `editing source 3:42.6–4:27.9 (45s, candidate)` | the current choice, in timecode. "candidate" means the AI suggested it |
| **Suggest windows with AI** and the ★ buttons | click one and that part of the video becomes the one you're editing |
| the video itself | the newest render, playable in place |
| `0:00.0 / 1:43.6` and the bar under it | where you are, and the timeline. Click to jump, drag to select a stretch |
| **Cut · No captions · Text card · Image · Instruction** + **Add note at playhead** | the composer: select a stretch, then leave a note about it |
| the notes list (`NO CAPTIONS 0:30.0 …`) | every note you left, with an × to delete it |
| **Re-render · Plan cuts with AI · Ask for a review** | do the work, or ask the AI about it |
| `latest: …mp4` | which file you are watching |
| **CAPTIONS / FONT / SOUND / PACE / MUMBLES / FORMAT / BACKGROUND / GRAPHICS** | the settings column, exercised in T3 |

If you see all of that, everything underneath is working. If the tab is there but blank, the page is
stale — hard reload; if it persists, tell me.

## 0.5 How to stop it

Click the Terminal window you left open and press **`Ctrl + C`**. The browser tab will then show errors
until you start the server again.

## 0.6 Two things that will annoy you, and why

**① Every command the AI runs asks for your approval.** You will click "approve" a lot. That is not how
the product should behave — it is this laptop: macOS refuses to start the sandbox the AI normally runs
in, so each command needs a click. Please note it in the report; it is one of the things I most want to
know.

**② Things take tens of seconds.** A 45-second passage renders in about 45 seconds. While it runs the
button says **Rendering…** and the log under the player counts up (`…encoding 20% … 90%`). If both are
frozen, nothing is running — see Part 7.

---

# Part 1 — What happens to your video

Five minutes here makes everything else make sense.

## Nothing happens until you ask

Dropping a file into the folder does **nothing** on its own. It sits there until you tell the AI about
it. That is deliberate — you don't want an AI cutting footage because you saved a file.

## What the AI does with it, in order

When you say *"there's a new video in the incoming folder — prepare it and remove the bad takes and the
silences"*, four things happen:

**1. It looks at the file** (seconds). Size, resolution, frame rate, sound. It tells you what it sees.

**2. It makes a lightweight copy to work from** (minutes — the slow part). Editing works from a small
copy so every preview is fast. This happens **once per video**, not per edit, and it is cached: come back
tomorrow and it is still done.

**3. It writes down where every word is** (a minute or so). The sound is transcribed word by word with
timings — that is what makes captions possible and what lets the AI find pauses and stumbles.

**4. It finds your face and your silences** (seconds). Where your chin is (so captions don't cover it)
and where every pause is.

**Then it reports what it found and proposes a cut** — how many pauses, how much dead air, what it would
remove. You read that, and only then does a video appear.

## What that means for you

- The first video of the day takes a while; the second request on the same video is fast.
- The AI is not watching your face while it cuts. It hears stumbles, hesitations and pauses; it cannot
  tell whether a cut *looks* like a jump mid-gesture. That is the biggest known gap — exactly what your
  eyes are for.
- Every change costs one re-render. Short passage, short wait.

---

# Part 2 — The words I use

No video-editing background assumed. If a word below is unfamiliar, this is what it means here.

| Word | What I mean |
|---|---|
| **Cut** | removing a piece of video so what remains plays continuously |
| **Jump cut** | the small visual jolt when two distant moments are joined. Sometimes wanted, sometimes jarring |
| **Take / bad take** | a version of a sentence you recorded; usually you keep the last and cut the earlier ones |
| **Silence / dead air / pause** | time with no talking. Some is good (a breath makes a point land), most is waste |
| **Mumble / filler** | "um", "uh", "so", throat-clears, a sentence started and abandoned |
| **Passage / window** | a stretch of the video, e.g. 3:42 to 4:27 |
| **Caption** | words on screen matching what is being said |
| **B-roll** | other footage shown while you keep talking — cutaways that make a video less static |
| **Motion graphics** | designed text/cards/animations on screen: titles, statistics, quotes |
| **Render** | the computer producing a finished video file from your edit |
| **Preview vs final** | preview is a small, fast version for judging; final would be full quality. **Only preview exists so far** |
| **Lightweight copy (proxy)** | the small copy the editor works from, so previews are quick |
| **Timeline** | the bar under the player. Left edge is the start, right edge the end of the passage |

---

# Part 3 — Where your files live

Everything is inside `studio/`. Three folders matter:

```
studio/fixtures/incoming/     ← drop your raw video here
studio/projects/<name>/       ← the AI's workspace for that video (notes, cut decisions, assets)
studio/out/                   ← the videos it has made. This is where you watch results
```

You only ever need the first and the third. `projects/` is what the AI reads and writes; don't tidy it.

One project already exists, called **`test-vid`** — an 8-minute Russian talking-head video, already
prepared, transcribed and cut once. That is what you start with, so the interesting parts can be tested
without waiting.

---

# Part 4 — The order you'll actually work in

You don't have to do all of this. Each step ends with a video you can watch, and you can stop at any
layer.

```
1. give it a video          →  "prepare this, remove the bad takes and silences"
2. watch it, say what's off →  "too fast between 4:05 and 4:20"
3. captions                 →  "put captions on, word by word"
4. graphics / B-roll        →  "generate some graphics, show me first"
5. review                   →  "watch it and tell me what's weak"
```

Each step is one conversation turn plus one wait. If a step gets worse, say so in the words you would use
with a human editor — that is what is being tested.

---

# Part 5 — How to read the tests

Every step from here has the same shape:

> **Say** — what you type in the chat
> **Expect** — what happens and what appears
> **Judge** — the question only you can answer

Write your answers in the empty boxes. The report template is at the end.

---

# Part 6 — What things cost (measured, not guessed)

Rendering scales with how much video you render. Measured on the preview path, three real renders:

| passage | took |
|---|---|
| 8 s | 18 s |
| 55 s | 43 s |
| 104 s | 66 s |

Which fits **≈14 s of fixed cost + half a second per second of video**: 30 s → ~29 s, 2 min → ~75 s,
10 min → ~5.3 min. The first three are measured; past 2 minutes is extrapolation from the same line.

**The consequence that matters:** the editor renders **the passage you are working on**, not the whole
file. Editing a 20-minute interview in 60-second windows costs the same per iteration as editing a
1-minute clip.

**Preparation is the slow part, and it scales with the video**, because it decodes the original — 8
minutes of 4K60 phone footage took **33 minutes** here. Why, and what to do:

| your video | prepares at | 2 min video | 30 min video |
|---|---|---|---|
| 4K60 HEVC (phone default) | 0.29× realtime | ~7 min | ~1 h 45 min |
| 4K60 H.264 | 2.9× | ~40 s | ~10 min |
| 1080p60 HEVC | 6.3× | ~20 s | ~5 min |
| **1080p60 H.264** | **10.9×** | ~11 s | **~3 min** |

This laptop is from 2012 and has **no hardware decoder for HEVC**, which is what phones record — so it
falls back to slow software decoding. **The fix is free:** export the clip as **1080p H.264** before
dropping it in (iPhone: Settings → Camera → Formats → Most Compatible, then export from Photos at 1080p).
A 30-minute video then prepares in ~3 minutes instead of two hours, and editing is unchanged.

Preparation is paid **once per video**, and it is cached.

Two honest caveats: the test copies above were encoded with fast settings, so real camera H.264 decodes
somewhat slower; and nothing longer than 105 seconds has been rendered, so the long-form rows are
estimates.

---

# T1 — The layers, on prepared footage (≈45 min)

`test-vid` is already prepared. Each step is a sentence you actually say, then a video to judge. Each
re-render is about 45 seconds.

## T1.1 — "Let me see what you have" (2 min)

> **Say:** *"Show me the current state of the test-vid project and the latest render."*

**Expect:** which passage you're editing, the settings, how many notes exist, the path of the latest
render, and where the footage is on disk.

> **Judge:** was that summary accurate and understandable? Did it tell you *where* the video is?

```
```

## T1.2 — "Remove the bad takes and silences" (10 min)

> **Say:** *"Cut the bad takes and the silences from the 3:42–4:27 window. Decide yourself how much of
> each pause to keep, and tell me what you decided."*

**Expect:** approval prompts (approve them) → a render with a progress log → a report listing each pause
and what it did, e.g. *"cut hard on «я не знал ⟪⟫ он мог это сделать» (a false start), kept 320 ms after
«Бог очень слабый»"* → a file path.

> **Judge:** does the cutting feel like an editor made it? Which single decision was wrong?

```
```

## T1.3 — "It is too fast here" (5 min)

> **Say:** *"Between 4:05 and 4:20 it feels rushed. Give the pauses more room there and show me."*

**Expect:** only those pauses change, a re-render, and the passage breathes more. Total length grows
slightly.

> **Judge:** did it change *only* that region, or did the whole cut shift?

```
```

## T1.4 — "Now let's put captions" (5 min)

> **Say:** *"Add captions — word by word — and tell me where they sit and how many there are."*

**Expect:** captions under your chin; a report of page count, style, and that it checked they clear your
face.

> **Judge:** readable, right size, right position? Is word-by-word comfortable or too busy?

```
```

## T1.5 — "Generate graphics, show me first" (10 min)

> **Say:** *"Generate three graphics ideas that fit this argument — a title card, a stat card, and
> something for the 95/5 contrast. Put them in a folder I can look at; don't put them in the video yet."*

**Expect:** image files under `projects/test-vid/assets/`, with **paths**, a description of each, and
where each would go. The video does not change.

> **Judge:** could you open the files? Did the ideas fit the argument?

```
```

## T1.6 — "Put them in where appropriate" (10 min)

> **Say:** *"Use the stat card and the 95/5 one. Put them where they help the argument, not over my
> face."*

**Expect:** placements (which second, which corner, how big), a re-render, and a reason for each. Images
land **on the side away from your face**.

> **Judge:** good placements? Too big, too small, too long on screen?

```
```

## T1.7 — "Insert B-roll as you see fit" (10 min)

> **Say:** *"Add B-roll where you think it helps. Use what's in the assets folder, or tell me what you're
> missing."*

**Expect:** either placements with reasoning, or an honest "there is no usable B-roll here; I would need
X". **Both are acceptable** — the second is more likely.

> **Judge:** if it improvised, was the timing right? If it asked, was the request actionable?

```
```

## T1.8 — Review in the pane and leave notes (10 min)

| # | Do this | Expect |
|---|---|---|
| 1 | Play the video; click the bar under the player | the video jumps there; the yellow playhead moves |
| 2 | Drag across the bar | a blue selection appears; readout shows `selected 0:12.0–0:18.0` |
| 3 | Composer → **No captions** → **Add note at playhead** | a row appears in the notes list; a render starts |
| 4 | Play that stretch in the result | captions gone **exactly there**, unchanged elsewhere |
| 5 | Composer → **Cut**, select a stumble, add it | the stretch is removed; the video shortens |
| 6 | Composer → **Instruction**, type *"make the captions bigger from here"* | the note is stored but **nothing changes** — free text is for the AI, not the renderer; the log says `needs the agent` |

> **Judge:** was leaving a note clearer than typing the same thing in chat? Step 6 especially — was it
> obvious that Instruction notes do nothing on their own?

```
```

## T1.9 — "Ask for a review" (5 min)

> **Say:** *"Watch the latest render and tell me what is weak about it."*

**Expect:** specific criticism from the numbers it can read (transcript, cut decisions, notes, render
log), or an honest "I cannot see the frames". It should **not** invent impressions of the picture.

> **Judge:** specific and useful, or generic? Did it pretend to have watched?

```
```

---

# T2 — From raw footage (the real first day, ≈50 min)

Run this once, with a **short clip** if you have one.

## T2.1 — Put the file where the system expects it

Drop a video into `studio/fixtures/incoming/`. Ideally **1–3 minutes** and ideally **1080p H.264** (Part
6 explains why): a 1-minute 4K60 HEVC clip costs ~4 minutes of preparation and a 3-minute one ~12,
while the same clips as 1080p H.264 cost well under a minute each.

**Then nothing happens.** Confirm that, and confirm the AI tells you what to do about it.

## T2.2 — The first real request

> **Say:** *"There is a new video in the incoming folder. Prepare it and remove the bad takes and the
> silences. Tell me what you find before you cut anything."*

**Expect, in this order:**
1. It lists the folder and confirms which file (it should ask if there is more than one)
2. It starts preparing: `3840x2160 @ 60 fps · hevc · … GB`, then `…preview 20% … 100%`, then the
   lightweight copy, then `record written`
3. It transcribes and reports word count, segment count, cost, detected language
4. It reports what it found: pauses, dead air, stumbles
5. **Only then** does it propose a cut and render

> **Judge:** did it talk to you *before* cutting, as asked? Did the numbers make sense — dead air %,
> language, word count?

```
```

## T2.3 — The acceptance question

> **Judge:** watch the result. **Would you have paid an editor for this cut?** If not, name the single
> worst moment. That sentence is the most valuable thing in your report.

```
```

## T2.4 — The second layer, on the new project

> **Say:** *"I like it. Now put captions on it."*

**Expect:** the same caption behaviour as T1.4 on the new footage — which proves the pipeline is general
and not tuned to one clip.

```
```

---

# T3 — The buttons (secondary, ≈15 min)

Every control has a tested backend; this is a smoke test that the screen honours it. Each click starts a
re-render, so wait for it (or the next click queues behind it).

| # | Click | Expect |
|---|---|---|
| 1 | **One word at a time**, then **Phrase, active word highlighted** | one word larger; then the whole phrase with the spoken word highlighted |
| 2 | **Font → Bebas Neue**, then **Montserrat** | visibly different lettering, same size |
| 3 | **Sound → Raw audio**, listen | thinner, duller |
| 4 | **Mumbles → Keep everything**, then back | slightly longer and rougher, then tighter |
| 5 | **Format → Horizontal 16:9** | the frame widens; a blue line says the background was reset |
| 6 | **Background → Blurred background** while horizontal | refused, with the reason — not silently ignored |
| 7 | **Format → Vertical 9:16** + **Background → Studio look** | the full frame fitted over a blurred copy, slightly vignetted |
| 8 | **A grey time button**, then **a ★ button** | the passage changes straight away and a render starts |
| 9 | **Suggest windows with AI** | the AI proposes passages; ★ buttons appear |
| 10 | **Plan cuts with AI** | the AI rewrites the cut for the current passage and re-renders |
| 11 | **Ask for a review** | it asks the AI about the current render |
| 12 | **Replay**, then the bar under the player | the video replays; clicking jumps |

> **Judge:** which of these felt like a real editor's control, and which felt like a debug switch?

```
```

---

# Part 7 — When something goes wrong

| What you see | What is actually happening | What to do |
|---|---|---|
| **The page does not load** | the server is not running (Terminal closed, or the laptop slept) | run `./start.sh` again. If it says `Already running`, wait 10 s and reload |
| **The page loads but there is no Studio tab** | you are on the session list, not inside a conversation | click a session, or **New session** and send a message |
| **The Studio tab is blank** | stale page | `Cmd + Shift + R` |
| **I dropped a video and nothing happened** | expected — nothing happens until you ask | say *"there's a new video in the incoming folder — prepare it"* |
| **"Rendering…" never ends** | if the log is frozen, the render died | ask for a re-render, or click **Re-render**. A render is killed automatically after 15 minutes |
| **A click does nothing while rendering** | only one render at a time | it says "Next render queued" — wait |
| **The video is the old one after a change** | the player shows the newest render; the change may have queued behind it | wait, then **Replay** |
| **It asks permission for every command** | this machine cannot run the AI's sandbox | approve it; and report it |
| **It says a file is missing** | the project was never prepared, or the folder moved | ask it to check the project state first |
| **A remark of mine was ignored** (Instruction note) | free-text notes are for the AI, not the renderer | say the same thing in the chat |

---

# Part 8 — What NOT to report as a bug

| Known limitation | What you will see |
|---|---|
| **No final quality** | everything is a small preview. No 1080p export, no subtitle file, no thumbnail, no uploading |
| **No drag-to-trim** | you choose a passage; you cannot drag its in/out points |
| **Graphics land where the AI decides** | 32 % of the width, on the side away from your face, top corner. No size slider, no drag |
| **No B-roll library** | you can point it at files in `assets/`; there is no search or tagging |
| **Instruction notes don't act by themselves** | they are stored for the AI, not applied by the renderer |
| **Approval for every command** | this machine, not the product |
| **Cutting is deaf to the picture** | it hears stumbles and beats; it cannot tell whether a cut *looks* jumpy mid-gesture |
| **Passage suggestions are text-only** | the AI reads the transcript; it has not seen the frames |
| **One video at a time** | no batch, no "three shorts from one long video" |
| **One passage at a time** | no "render the whole 20-minute interview in one file"; a render is killed at 15 minutes (~28 minutes of video) |
| **Long-form has never been tested end to end** | only 45–105 s passages have actually been rendered |

---

# Report template

```
## Which parts I did
Day 0 / T1 / T2 / T3   (delete what does not apply)

## Getting it running
- how long did Day 0 take? where did you get stuck, if anywhere?

## The conversation
- Did the AI understand plain-language requests? where did it guess wrong?
- Did it explain what it decided — readable, or jargon?
- Did it talk before acting when you asked it to?

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
- was ~45 s per iteration acceptable? what would you accept for a 2-minute passage (~75 s)?
```

---

## Timing summary

| | |
|---|---|
| Day 0 — get it running and look at the editor | 10 min |
| T1 — the layers on prepared footage | ~45 min (≈45 s per re-render) |
| T2 — from raw footage | ~50 min (≈5 min preparation for a short clip) |
| T3 — the buttons | ~15 min |
| **Total** | **under two hours**, splittable |

Do Day 0 and T1 in one sitting, T2 in another. If T1 already convinces you the editing is bad, say so —
that is a result, not a wrong test.
