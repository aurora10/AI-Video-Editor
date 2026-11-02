# Proof: segment-level incremental rendering

A throwaway benchmark (not product code) that validates the design's central claim:

> A review note that changes a few seconds of a video re-renders only the segments covering that change.

## Run it

```sh
cd proofs/segment-cache
node build.mjs
```

Needs `ffmpeg`/`ffprobe` on PATH. Rebuilds its own synthetic source each run (~1 min on the reference machine), so the directory can be cleaned at any time.

## What it does

1. Synthesises a 30 s 1080×1920@30 source with three silent "pauses".
2. Derives a cut list, dropping the pauses → a 24 s program across 4 clips.
3. Generates karaoke-style captions as ASS and burns them with `libass` (the T0 render path).
4. Renders each clip as an independent segment with identical encoder parameters and a forced IDR at frame 0 (`keyint_min=keyint`, `scenecut=0`) so segments can be concatenated without re-encoding.
5. Assembles with the concat demuxer (`-c copy`).
6. Applies one review note affecting a single caption → re-renders **only that segment**, reuses the other three, re-assembles.

## Results (Intel i7-3720QM, 8 GB, FFmpeg 7.0.2)

| Measurement | Value |
|---|---|
| Source build (30 s) | 10.9 s |
| Cold render, 4 segments + concat | **14.2 s** (segments 13.8 s + concat 0.44 s) |
| One-note round, 1 dirty segment + concat | **4.2 s** |
| Speedup | **3.37×** |
| Untouched segments | byte-identical across revisions (sha256) |
| Caption burn verified numerically | caption-band `YMAX` 209 → 235 |

The 3.37× is the pessimistic case: 4 segments over 24 s means one note dirties 25 % of the timeline. At the segment granularity the spec targets (1.5–6 s → 12–15 segments for a 60 s short), a one-note round dirties ~7 % and the ratio approaches ~10×, bounded by concat overhead.

## Why it matters to the spec

- Confirms **ADR-005** (segment as render atom) and the dirty-interval minimality invariant (`development-plan.md` §7.3).
- Establishes the T0 throughput baseline (**≈0.6× realtime** at 1080×1920 on this hardware) used for NFR-04 and NFR-13.
- Establishes that **concat of independently encoded segments is byte-stable**, which is what makes the cache safe.

## Known limits of this proof

- Synthetic source (moving test pattern), so no face/typography/audio-muxing realism.
- No Chromium tier (T1) — that is gate **S3**, not covered here.
- Audio is per-segment AAC here; the real design mixes audio full-length per revision (ADR-006) to avoid seams.
- Segments are one-per-clip, not yet the 1.5–12 s planner of step C3.

## Files

```
build.mjs                 the benchmark
out/preview-rev1.mp4      cold render
out/preview-rev2.mp4      after the one-note round (caption in segment 2 changed)
frames/rev1-at-2s.png     frame from rev1
frames/rev2-at-8.6s.png   frame from rev2, inside the re-rendered segment
```
