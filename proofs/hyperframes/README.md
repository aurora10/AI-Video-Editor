# Proof: HyperFrames window rendering, determinism, throughput (gate S3)

Answers the three questions gate **S3** asks, with measurements on the target machine
(Intel i7-3720QM, 8 GB, Chrome headless-shell 152, FFmpeg 7.0.2, HyperFrames 0.8.226, `--workers 2`).

## The composition

`index.html` — 540×960 @30 fps, 12 s, five elements (three sliding bands, a ring, a box). Every
pixel-changing property comes from **one paused GSAP timeline** registered on
`window.__timelines['s3']`, so pixel state is a pure function of the frame index: no `Date.now`,
no `Math.random`, no `rAF`, no runtime fetches. `gsap.min.js` is vendored locally for the same
reason. `index-1080.html` is the same file at 1080×1920.

```sh
export HOME="$PWD/studio/.cache/hfhome"        # HyperFrames writes ~/.hyperframes + a Chrome cache
export PUPPETEER_CACHE_DIR="$HOME/.cache/puppeteer"
studio/node_modules/.bin/hyperframes browser ensure    # downloads chrome-headless-shell into the workspace
studio/node_modules/.bin/hyperframes render . -c index.html -o out-win.mp4 --start 6 --end 9 --quality draft --workers 2
```

## 1. Absolute-time windowing — **confirmed**

A window render is *not* re-based to zero: frame `f` of `--start 6 --end 9` equals frame `f+180`
of a full render. Verified by SSIM, with a negative control so the metric cannot flatter itself:

| comparison | frames | mean SSIM | min SSIM |
|---|---|---|---|
| `window(6–9 s)` vs `full[6…9)` | 90 | **0.999892** | 0.9975 |
| **control:** `window(6–9 s)` vs `full[0…3)` | 90 | 0.880462 | 0.8516 |

(SSIM is not 1.0 because the window is its own encode pass; 0.9999 is visually identical.)

## 2. Determinism — **byte-identical**

Two window renders of the same span, compared by `framemd5` over decoded frames:

```
frames: 90 vs 90
✔ identical decoded frames (byte-for-byte)
```

## 3. Throughput — the number that changes the architecture

| render | wall | output | × realtime |
|---|---|---|---|
| 1 s window @540×960 | 16.8 s | 1 s | 0.060 |
| 3 s window @540×960 | 23.2 s | 3 s | 0.129 |
| 3 s window @540×960, `PRODUCER_EXPERIMENTAL_FAST_CAPTURE=1` | 27.0 s | 3 s | 0.111 |
| 3 s window @1080×1920 | 31.3 s | 3 s | 0.096 |
| 12 s full @540×960 | 69.5 s | 12 s | 0.173 |

Fitting the two window points (`t = a + b·n`): **fixed overhead `a ≈ 13.6 s`**, marginal cost
`b ≈ 3.2 s` per output second at 540×960, `≈ 5.9 s` at 1080×1920.

### What this means (and what changed because of it)

1. **Fixed overhead dominates small renders.** 13.6 s of browser launch, capability probe and
   encoder init is paid *per `hyperframes render` invocation*. Fifteen 3 s segments rendered
   separately would cost ≈15 × 23 s = 345 s; one 45 s render costs ≈13.6 + 45 × 3.2 ≈ 158 s.
   → **T1 segments must be batched into contiguous dirty runs, and T1 segment granularity must be
   coarse (≥8–12 s).** Per-segment *Chromium* caching is an anti-pattern on this hardware.
2. **T0 (FFmpeg/libass) has no such overhead and is ~3.5× faster.** The segment-cache proof
   measured 14.2 s for 24 s of 1080×1920 (0.59× realtime) with 0.44 s reassembly. A 4 s note
   round cost 4.2 s. → **The T0-first strategy is now evidence-backed, not a hunch**: captions and
   simple layouts stay in FFmpeg; Chromium is reserved for motion-graphics bursts.
3. **Delivery renders are borderline, not comfortable.** A 60 s 1080p render ≈13.6 + 60 × 5.9 ≈
   **370 s (≈6 min)** at 2 workers. NFR-04's "≤5 min" needs either 4 workers (untested on 8 GB) or
   a relaxed target.
4. **`PRODUCER_EXPERIMENTAL_FAST_CAPTURE=1` did not help** (27.0 s vs 23.2 s). The render log
   shows why: *"Browser capability probe selected screenshot capture for the entire chunk"* — the
   fast `beginFrame` path is unavailable here (headless-shell, no GPU under the harness sandbox),
   so every frame is a screenshot round-trip. This is the single biggest lever left unexplored —
   see **S3b** in `docs/build-plan.md`.
5. **Chunk overhead grows with length**: the model predicts 52 s for the 12 s render; measured
   69.5 s. Longer renders pay extra for chunk fan-out, so benchmark at *target length* before
   promising a latency figure.

## Files

```
index.html / index-1080.html   deterministic GSAP compositions (540×960, 1080×1920)
gsap.min.js                    vendored (no CDN fetch at render time)
measurements.json              the table above, machine-readable
out-*.mp4                      renders: full, window ×2, 1 s, 1080p, fast-capture
w1.md5 / w2.md5                decoded-frame hashes proving determinism
ssim.log                       per-frame SSIM of the control comparison
```

Environment caveats found while getting this to run at all (both matter for the product):
HyperFrames writes `~/.hyperframes` and a puppeteer cache, so the harness sandbox denies it unless
`HOME`/`PUPPETEER_CACHE_DIR` are relocated into the workspace; and Chrome needs
`--no-sandbox --disable-crash-reporter --disable-breakpad` with an isolated `--user-data-dir` to
run inside the sandbox at all.
