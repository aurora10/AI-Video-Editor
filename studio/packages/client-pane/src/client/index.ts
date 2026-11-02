/**
 * Client half of the Studio pane: contribute one entry to the `conversation.view`
 * list slot so a "Studio" tab appears beside Chat.
 *
 * Registration rides the slot service's effect wrapper, so unloading the plugin
 * removes the tab (the HMR/dispose invariant the harness expects).
 */
import type { ClientContext } from './dsh.ts'
import { StudioView } from './StudioView.tsx'

/** Services this plugin needs: the slot registry. */
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'studio',
        order: 20,
        label: () => 'Studio',
        inject: (sessionId: string) => ({ sessionId, source: 'dsh-video-client-pane' }),
      },
      StudioView,
    ),
  )
}
