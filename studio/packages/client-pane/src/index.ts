/**
 * Host half of the Studio pane package.
 *
 * The client-module scanner only sees packages mounted as Loader rows, so this
 * module must exist and export a valid (Cordis) plugin — even while it does
 * almost nothing. It grows the `/video` routes and the project service in
 * phases B–E.
 */
export const name = 'dsh-video-client-pane'

/** Services: none yet. The HTTP route and project service arrive with host-server. */
export const inject: string[] = []

export function apply(): void {
  // Intentionally quiet: mounting this row is what makes the browser bundle
  // discoverable at /plugins/dsh-video-client-pane/client.js.
}
