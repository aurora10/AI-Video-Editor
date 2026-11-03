/**
 * `@dsh-video/core` — the shared, environment-free brain.
 *
 * Pure by construction: no `node:*`, no DOM, no clock, no randomness. Both the host
 * renderer and the browser preview import this module, so a divergence between what
 * the pane shows and what the renderer burns is a build-time impossibility rather
 * than a QA finding.
 */
export * from './schema.js'
export * from './analysis.js'
export * from './fonts.js'

/** Bumped whenever `resolve()` output could change for an unchanged EDL. */
export const RESOLVER_VERSION = 0
