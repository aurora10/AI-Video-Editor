/**
 * Client half of the Studio pane: contribute one entry to the `conversation.view`
 * list slot so a "Studio" tab appears beside Chat.
 *
 * Registration rides the slot service's effect wrapper, so unloading the plugin
 * removes the tab (the HMR/dispose invariant the harness expects).
 */
import type { ClientContext } from './dsh.ts'
import { StudioView } from './StudioView.tsx'

declare global {
  interface Window {
    __DSH_STUDIO_DIAG__?: Record<string, unknown>
  }
}

/** Diagnostic channel: a headless probe reads this to tell *where* registration stops. */
const diag: Record<string, unknown> = {
  moduleLoadedAt: Date.now(),
  applyCalled: false,
  injectCallbackRan: false,
  registered: false,
  error: null,
  contextKeys: null,
  slotsKind: null,
}
if (typeof globalThis !== 'undefined') {
  ;(globalThis as Window).__DSH_STUDIO_DIAG__ = diag
}

/** Services this plugin needs: the slot registry. */
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  diag.applyCalled = true
  diag.contextKeys = Object.keys(ctx as object)
  diag.slotsKind = typeof (ctx as ClientContext).slots
  try {
    ctx.slots.inject('conversation.view', () => {
      diag.injectCallbackRan = true
      try {
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'studio',
            order: 20,
            label: () => 'Studio',
            inject: (sessionId: string) => ({ sessionId, source: 'dsh-video-client-pane' }),
          },
          StudioView,
        )
        diag.registered = true
      } catch (error) {
        diag.error = String(error)
      }
      return () => {}
    })
  } catch (error) {
    diag.error = String(error)
  }
}
