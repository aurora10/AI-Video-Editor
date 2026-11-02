/**
 * Minimal structural types for the DSH client runtime.
 *
 * Out-of-tree plugins cannot depend on `@deepseek-ai/*` npm packages (they are
 * workspace-private in the harness), so we describe only the surface we use and
 * let the real objects satisfy it structurally. If DSH changes these shapes the
 * spike's runtime check fails loudly, which is the point.
 */
export interface ClientContext {
  effect(fn: () => void | (() => void), label?: string): void
  slots: SlotsService
}

export interface SlotsService {
  /** Contribute into a slot somebody else declared; the callback runs when it is live. */
  inject(key: string, contribute: () => () => void): void
  register(options: SlotRegistration, component: unknown): () => void
}

/** Options for a list-kind slot entry such as `conversation.view`. */
export interface SlotRegistration {
  name: string
  id: string
  order?: number
  locale?: string
  label?: () => string
  inject?: (sessionId: string) => Record<string, unknown>
  [extra: string]: unknown
}

/** Props our view receives: injected values plus whatever the slot owner passes. */
export interface StudioViewProps {
  sessionId?: string
  [extra: string]: unknown
}
