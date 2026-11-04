# DSH Studio — Testing Guide

**Who this is for:** you, testing the system before the next round of development.
**What to do:** follow the workflows in order. Each step says what to do, what you should see, and how long it takes. Write your notes in the space provided — the report template is at the end.

**How to use this document:** work top to bottom. If a step fails, stop that workflow, note it, and move to the next one — don't retry more than twice. Most failures are in the "Expected" line, so compare carefully.

---

## 0. Before you start

### 0.1 Is everything running?

The GUI should be at **http://127.0.0.1:3099**. If the page does not load, the server is down and needs restarting — tell me, don't debug it yourself.

### 0.2 Hard-reload first

**`Cmd + Shift + R`**. I have changed the pane several times; a normal reload can serve you a stale bundle and make you report bugs that no longer exist. Do this at the start of **every** testing session.

### 0.3 What "rendering" looks like

A render takes **45–60 seconds** on this machine. It is not instant and it is not broken.

| Where to look | What it says while rendering |
|---|---|
| The green-ish button | **"Rendering…"** |
| Log box under the player | Lines appear, ending with `…encoding 10%`, `20%`, … `90%` |
| Anything else | Nothing changes until it finishes |

If the button says "Render changes" and nothing else is happening, **no render is running** — press it.

### 0.4 Ground rules for your notes

- Say what you **expected** and what you **got**. "Nothing happened" is less useful than "I clicked Save and expected the video to change; the button still said Render".
- Note the **step number** (e.g. W3.4) with each note.
- Screenshots are welcome but not required.
- If the video content surprises you, say so — that is data about the *editing*, not the app.

---

## W1 — First look (2 minutes)

**Goal:** confirm the pane loads and shows your project.

| # | Do this | Expect |
|---|---|---|
| W1.1 | Open http://127.0.0.1:3099 | The DSH GUI loads |
| W1.2 | Click the session **"Greeting to the AI assistant"** in the left sidebar | A conversation opens; the header shows **Chat · Trajectory · Studio** |
| W1.3 | Click **Studio** | A video player appears on the left, a settings column on the right |
| W1.4 | Look at the player | A vertical video, 540×960, with burned-in Russian captions and a blurred background |
| W1.5 | Read the header line above the player | The project name (`test-vid.mp4`) and `session …` |
| W1.6 | Look at the right column | Eight blocks: CAPTIONS, CAPTION STYLE, FONT, SOUND, PACE, MUMBLES, FORMAT, BACKGROUND, GRAPHICS AND B-ROLL |
| W1.7 | Check nothing says "not built yet" | All controls should be enabled — that label was removed deliberately |

**Report here:** did the video play? any block missing? anything looking broken?
```
```

---

## W2 — Choosing which part of the footage (5 minutes)

**Goal:** this is the feature that decides whether the whole system is useful, because everything else applies to the chosen window.

### W2.1 The heuristic candidates

| # | Do this | Expect |
|---|---|---|
| W2.1.1 | Find the **WINDOW — WHICH PART OF THE FOOTAGE** block | Text inputs "from" / "to", a **Use this window** button, and grey buttons with time ranges |
| W2.1.2 | Read the small grey line under the inputs | Something like `editing source 3:42.6–4:27.9 (45s, candidate)` |
| W2.1.3 | **Click a grey time button** (e.g. `0:15–0:58 · 43s`) | The grey line changes to that range **immediately**; the render button becomes "Rendering…"; after ~50s the player shows that different passage |

### W2.2 The AI candidates

| # | Do this | Expect |
|---|---|---|
| W2.2.1 | Find the button **Suggest windows with AI** | It sits inside the Window block |
| W2.2.2 | Note the gold **★** buttons if they are already there | Four with titles like *"God lost, the devil won"* |
| W2.2.3 | **Hover a ★ button** | A tooltip explains why that window stands alone |
| W2.2.4 | **Click a ★ button** | The window changes to that range; a render starts; the player updates |

### W2.3 If you press "Suggest windows with AI"

**Expect this to be slow and noisy, and that is not a bug** — it is the sandbox limitation on this machine:

1. A blue line appears: *"Asked the agent to propose windows on meaning…"*
2. The **chat tab** starts showing the agent working
3. **You will be asked to approve a shell command — repeatedly, once for each command.** This is macOS refusing to run nested sandboxes on this machine. Approve them.
4. When the agent finishes, new ★ buttons appear in the Window block (the pane re-checks every 5 seconds for up to 3 minutes)

**Report here:** did the grey buttons work? did the ★ buttons appear with sensible titles? did you try asking for fresh suggestions, and did the approvals make it painful?
```
```

---

## W3 — Changing the look (10 minutes)

**Goal:** every control should change the video. **Auto-render is ON**, so each click starts a render by itself.

**Important:** wait for each render to finish before clicking the next control, or you will be looking at a video that does not match your settings. If you do click twice quickly, the pane now **queues** the second render instead of showing an error — you will see a blue line saying *"Next render queued"*.

### W3.1 Captions

| # | Do this | Expect |
|---|---|---|
| W3.1.1 | Click **Pace → Fast (all pauses cut)** | Render starts; result is tighter and faster |
| W3.1.2 | Click **Pace → Calm (keeps a breath)** | Renders longer; speech feels less rushed |
| W3.1.3 | Click **Caption style → Phrase, active word highlighted** | The whole phrase stays on screen and the spoken word turns **yellow and slightly bigger** |
| W3.1.4 | Click **Caption style → One word at a time** | One word on screen, larger |
| W3.1.5 | Click **Captions → No captions** | Captions gone from the video |
| W3.1.6 | Click **Captions → Captions** | They come back |

### W3.2 Typeface

| # | Do this | Expect |
|---|---|---|
| W3.2.1 | Click **Font → Bebas Neue**, wait for the render | Captions visibly change shape (tall, condensed, capital letters) |
| W3.2.2 | Click **Font → Montserrat** | Clearly a different, heavier face |
| W3.2.3 | Click **Font → Oswald** | Condensed, tall |
| W3.2.4 | Check the caption **size stays the same** across fonts | It should not jump between renders; a small difference is acceptable on very long words |

### W3.3 Sound

| # | Do this | Expect |
|---|---|---|
| W3.3.1 | Play the video, listen for 15 seconds | Voice should sound fuller and clearer than the raw recording |
| W3.3.2 | Click **Sound → Raw audio**, wait, listen again | Noticeably thinner and duller |

### W3.4 Mumbles

| # | Do this | Expect |
|---|---|---|
| W3.4.1 | Click **Mumbles → Keep everything** | Slightly longer, slightly rougher |
| W3.4.2 | Click **Mumbles → Remove mumbles** | Short tighter gaps where you stumbled |

### W3.5 Format and background

| # | Do this | Expect |
|---|---|---|
| W3.5.1 | Click **Format → Horizontal 16:9** | The player switches to a wide frame; a blue line explains the background was reset to *None* |
| W3.5.2 | Click **Background → Blurred background** while horizontal | You get a message that it only applies to vertical — the control should not silently do nothing |
| W3.5.3 | Click **Format → Vertical 9:16**, then **Background → Blurred background** | Vertical frame: your whole frame fitted in the middle, blurred copy filling above and below |
| W3.5.4 | Click **Background → Studio look** | Same layout, slightly darker and more vignetted |
| W3.5.5 | Click **Background → Crop to fill** | Vertical, but fills the frame by cropping the sides — you lose most of the room |

**Report here:** which changes were visible, which were not, and whether the wait between renders was tolerable
```
```

---

## W4 — Editing a moment (15 minutes)

**Goal:** the timeline. This is the part that turns settings into directing.

| # | Do this | Expect |
|---|---|---|
| W4.1 | Find the horizontal bar under the player with a time readout below it (e.g. `0:00.0 / 0:35.0`) | That is the timeline |
| W4.2 | **Click halfway along the bar** | The video jumps to that moment; the readout changes; a yellow playhead line moves |
| W4.3 | **Drag along the bar** | A blue selection appears; the readout adds `selected 0:12.0–0:18.0` |
| W4.4 | With a selection made, click the button **No captions** in the composer row, then **Add note for selection** | A render starts; afterwards a small **×** row appears in the notes list, e.g. `NO CAPTIONS 0:12.0 let this breathe` |
| W4.5 | Play the selection range in the result | **No captions in that stretch**; captions elsewhere are unchanged |
| W4.6 | Click the **Cut** button, drag a selection over something you dislike (a stumble, a tangent) | Captions disappear from the notes list entry? No — a **CUT** row appears |
| W4.7 | Play the result around that point | The selected stretch is **removed** and the video is shorter |
| W4.8 | Click **Text card**, type something in the box, drag a 3-second selection, Add | After the render, your text appears **full screen** for those 3 seconds |
| W4.9 | Click **Image**, pick `card.png` from the dropdown, drag a selection, Add | After the render, the image appears **on the side away from your face** |
| W4.10 | Click **Instruction**, type *"make the captions bigger here"*, add it | It is stored **but nothing changes in the video** — see the warning below |
| W4.11 | Press **×** on a note to delete it | The note disappears; a render starts; the effect is gone from the video |

**⚠️ Important:** the **Instruction** note type is stored and shown, but the renderer cannot act on free text. It is printed in the render log as `needs the agent`. Do report whether the distinction was clear to you — if it wasn't, the UI is at fault.

**Report here:** did each note type do what the table says? did the timeline feel usable or fiddly? which note type did you want that is missing?
```
```

---

## W5 — Letting the AI cut (10–20 minutes, depending on approvals)

**Goal:** per-pause judgement instead of one global pace.

| # | Do this | Expect |
|---|---|---|
| W5.1 | Pick a window first (W2), e.g. the ★ *"God caught off guard"* | — |
| W5.2 | Click **Plan cuts with AI** | A blue line: *"Sent to the agent…"*; the chat tab shows the agent working |
| W5.3 | **Approve each shell command** the agent asks for | Same sandbox limitation as W2.3 |
| W5.4 | Wait for the agent to say it is done, then look at the pane | The player shows a re-rendered version |
| W5.5 | Compare with the same window **before** you planned cuts | The planned version should feel deliberately paced: stumbles gone, but beats after strong statements kept |
| W5.6 | Read the render log under the player | A line like `cut plan: 11 decisions by agent — filler 3 · beat 3 · stumble 3 · breath 2` |

**The judgement question I most want answered:** does the AI-planned cut feel *better* than the global "Calm" pace, or just different? If it feels worse, say which moment it got wrong.

**Report here:**
```
```

---

## W6 — Checking my claims (10 minutes)

**Goal:** these are the things I have asserted with measurements. Please try to break them.

| # | Claim | How to test | Expect |
|---|---|---|---|
| W6.1 | Captions never cover your face | Watch any render closely at several points | Captions sit **below your chin**, never over eyes or mouth; you may see them touch the top of your head — that was accepted |
| W6.2 | Captions are one consistent size | Watch two different passages | Type should not change size between captions |
| W6.3 | Captions never clip at the frame edge | Look at long words: «Фундаментальная», «протестантская» | Words fit inside the frame; nothing sliced off at the sides |
| W6.4 | No real words are lost | Compare a passage's captions to what you actually said | Every word you spoke appears on screen; only stumbles and fillers should be gone |
| W6.5 | The audio is fuller | Listen on headphones | Voice has body and clarity, not thin or muffled |
| W6.6 | Captions disappear where you asked | Add a "No captions" note over a stretch and watch it | Empty exactly there, present either side |

**Report here:** any claim that failed, with the timestamp in the video where you saw it
```
```

---

## W7 — Known limitations (don't report these as bugs)

These are real gaps, already on the list for the next round:

| Limitation | What you will see |
|---|---|
| **Final quality** | Everything is a **540p preview** made from a proxy. There is no 1080p export yet, no SRT file, no thumbnail, no upload |
| **Editing is per-moment only** | You cannot trim arbitrary in/out points by dragging; you choose a window and let pauses/mumbles/notes do the rest |
| **Graphics placement** | Image notes always go at 32 % width on the side away from your face. No size slider, no drag, no vertical control |
| **No B-roll library** | You can point at an image or clip in the project's `assets/` folder, but there is no search, no tagging |
| **Free-text instructions** | Stored and shown; not applied by the renderer. They need the agent |
| **Agent = one approval per command** | The macOS sandbox on this machine cannot start, so the GUI agent asks for every shell command |
| **AI cut judgement is audio-only** | It decides stumbles and beats from words and pauses. It cannot tell whether a cut *looks* jumpy mid-gesture — that work is not built yet |
| **Window suggestions are meaning-based, not visual** | The agent picks from the transcript; it has not seen the frames |
| **One video at a time** | No batch of reels, no "three shorts from one long video" |

---

## W8 — The report to send back

Copy this and fill it in. Anything you leave blank, I will assume worked.

```
## What worked
(workflows and steps that behaved as described)

## What didn't
step number | what I expected | what happened

## Judge the output, not the app
- Does the AI-planned cut feel better than "Calm" pace?  
- Do the ★ windows pick better moments than the grey ones?  
- Is the caption style right now (word-by-word, Oswald, yellow accent)?  
- Is the sound full enough, or still thin?  
- Is the background too strong, too weak, right?

## What I wanted to do and couldn't
(your own words — this is the most valuable section)

## Anything that looked broken but might be my mistake
```

---

## 9. How long this should take

| Workflow | Time |
|---|---|
| W1 first look | 2 min |
| W2 windows | 5 min (longer if you try asking the agent) |
| W3 the look | 10 min (≈50s per control change) |
| W4 timeline notes | 15 min |
| W5 AI cut planning | 10–20 min |
| W6 checking claims | 10 min |
| **Total** | **about an hour** |

Do it in two sittings if that is easier: W1–W3 first, then W4–W6.

---

## 10. If something is badly broken

1. Note the step number and what you saw.
2. Skip to the next **workflow** (not the next step) — one broken control does not stop the others.
3. If the GUI itself dies: tell me the URL stopped responding; I will restart the server and tell you when it is back.

Do not clear files, delete the project, or edit anything under `studio/projects/test-vid/` by hand — several tests depend on its current state, and I would rather debug a known state than a repaired one.
