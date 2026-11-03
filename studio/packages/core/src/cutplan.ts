/**
 * A per-pause cutting plan: the editorial decisions, written down.
 *
 * The pace slider applies one retention to every pause, which is why a slider-only cut feels
 * mechanical. This file lets each pause carry its own decision and its reason — whether it was made
 * by a rule, by the agent reading the context, or by the owner on the timeline.
 *
 * Stored against SOURCE time so a re-plan of the same footage is comparable, and so a changed
 * window does not shift what a decision refers to.
 */
import { z } from 'zod'

export const CutDecision = z.object({
  /** Pause start in source time — the key that ties this decision to a detected pause. */
  srcMs: z.number().nonnegative(),
  /** Milliseconds of the pause to KEEP. 0 = hard jump cut. */
  retainMs: z.number().nonnegative(),
  /** Why, in one line. Shown to the owner; kept because a plan nobody can read is a plan nobody trusts. */
  reason: z.string().default(''),
  /**
   * The editorial category, which is what makes the decision reviewable:
   *  stumble   — a false start or repeated phrase; cut hard, the viewer must not see it
   *  filler    — dead air between thoughts; cut
   *  breath    — between sentences; keep a little so the speech does not become staccato
   *  beat      — after a claim, a question or a punchline; KEEP, this is emphasis
   *  unknown   — no judgement available; fall back to the pace setting
   */
  kind: z.enum(['stumble', 'filler', 'breath', 'beat', 'unknown']).default('unknown'),
})
export type CutDecision = z.infer<typeof CutDecision>

export const CutPlan = z.object({
  schemaVersion: z.literal(1),
  /** Who wrote this plan. */
  planner: z.enum(['rules', 'agent', 'owner']).default('agent'),
  createdAt: z.string().optional(),
  decisions: z.array(CutDecision).default([]),
})
export type CutPlan = z.infer<typeof CutPlan>

/** Look up a plan's decision for a pause starting at `srcMs` (exact, then nearest within 250 ms). */
export function decisionFor(plan: CutPlan, srcMs: number): CutDecision | undefined {
  const exact = plan.decisions.find((d) => Math.abs(d.srcMs - srcMs) <= 5)
  if (exact !== undefined) return exact
  let best: { dist: number; d: CutDecision } | undefined
  for (const d of plan.decisions) {
    const dist = Math.abs(d.srcMs - srcMs)
    if (dist <= 250 && (best === undefined || dist < best.dist)) best = { dist, d }
  }
  return best?.d
}
