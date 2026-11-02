# DSH Studio

An agent-first video editing system for [DeepSeek Harness](https://github.com/deepseek-harness): drop raw footage in, get a reviewable edit back in the browser, leave timestamped notes, and have **only the pieces you touched** re-rendered before the final export.

Reverse-engineered from a working Claude-based workflow (see `docs/reference/transcript2.txt`), then rebuilt around three ideas the original does not have:

1. **The edit is data** — `edl.json`, word-anchored, resolved to frames by one pure function used by both the renderer and the browser preview.
2. **The segment is the unit of rendering** — content-addressed cache, so a note that changes 4 seconds re-renders ~4 seconds. *Measured on this machine: 14.2 s cold vs 4.2 s for a one-note round, untouched segments byte-identical.*
3. **Style is executable** — `skill.md` for the agent *plus* `rules.json` with code-backed validators, so "never make that mistake again" is enforced rather than hoped for.

## Status

| | |
|---|---|
| Phase | **Building.** Two architecture gates (S2, S3) must clear before product code. Live ledger: [`docs/build-state.md`](./docs/build-state.md) |
| Target | Single-operator, local (DSH `web` profile), out-of-tree plugin bundle · `deepseek-v4-flash` for bulk work · preview at 540p, delivery at 1080p |
| Hardware baseline | Intel i7-3720QM · 8 GB · FFmpeg 7.0.2 · Chrome 156 → T0-first, ≤2 Chromium workers |

## Documents

| Doc | What it is |
|---|---|
| [`docs/build-plan.md`](./docs/build-plan.md) | **The execution plan** — steps, gates, verification commands, blockers |
| [`docs/build-state.md`](./docs/build-state.md) | Live ledger: what is `pass`, `fail`, `blocked`, `cut` |
| [`docs/development-plan.md`](./docs/development-plan.md) | The engineering specification (requirements, architecture, data model, contracts, cost) |
| [`docs/reverse-engineered-blueprint.md`](./docs/reverse-engineered-blueprint.md) | The reference system reconstructed: prompt, 12 style rules, template taxonomy, review-app contract, run order, economics + a 17-item gap register |
| [`docs/hyperframes-vs-hypit-brief.md`](./docs/hyperframes-vs-hypit-brief.md) | Evidence for the toolchain decision (HyperFrames as renderer; Hypit's licence forbids the multi-tenant future) |
| [`docs/reference/`](./docs/reference/) | Original brief and the video transcript |

## Proofs (measured, kept)

`proofs/segment-cache/` — a runnable demonstration of the core claim:

```sh
cd proofs/segment-cache && node build.mjs
# cold render 4 segments (24 s of 1080x1920): 14.2 s
# one-note round (1 dirty segment + concat):   4.2 s   -> 3.37x
# untouched segments: byte-identical (sha256)
```

Outputs: `out/preview-rev1.mp4`, `out/preview-rev2.mp4` (watch the caption change in segment 2 only).

## Layout

```
docs/       specification, reconstruction, plan, ledger
proofs/     measured evidence
studio/     the product (pnpm workspace; created by build step A0)
```

## Next

`docs/build-plan.md` §12: skeleton + doctor → gate S2 → gate S3 → transport → media spine. Blockers are listed in §11 — the ASR key and one real clip are needed before the media spine can be validated on real footage.
