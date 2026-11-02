/**
 * Project layout on disk. One function owns the shape so no other module invents
 * a path: `project.json`, `media/`, `analysis/`, `edit/`, `notes/`, `style/`,
 * `render/`, `qa/`, `exports/`.
 */
import { join } from 'node:path'

export interface ProjectPaths {
  root: string
  record: string
  media: string
  proxies: string
  assets: string
  analysis: string
  edit: string
  notes: string
  style: string
  render: string
  qa: string
  exports: string
}

export function projectPaths(root: string): ProjectPaths {
  return {
    root,
    record: join(root, 'project.json'),
    media: join(root, 'media'),
    proxies: join(root, 'media', 'proxies'),
    assets: join(root, 'media', 'assets'),
    analysis: join(root, 'analysis'),
    edit: join(root, 'edit'),
    notes: join(root, 'notes'),
    style: join(root, 'style'),
    render: join(root, 'render'),
    qa: join(root, 'qa'),
    exports: join(root, 'exports'),
  }
}

/** Where one source's proxies live. */
export function sourceProxyDir(p: ProjectPaths, srcId: string): string {
  return join(p.proxies, srcId)
}
