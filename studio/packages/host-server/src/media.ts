/**
 * Range-capable media serving for the pane's player.
 *
 * DSH ships no Range support anywhere (verified: no `206`, no `Content-Range` in the whole
 * harness), while an HTML `<video>` needs it to scrub at all. Registered routes also sit
 * outside the harness's `/api` trust fence, so this module owns two things the framework
 * would otherwise provide: loopback-only access and path confinement.
 */
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ass': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** The harness's own browser-trust posture, re-implemented for a route outside `/api`. */
export function isTrustedLocalRequest(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').split(':')[0] ?? ''
  const bare = host.replace(/^\[|\]$/g, '')
  if (!LOOPBACK.has(bare) && !LOOPBACK.has(host)) return false
  if ((req.headers['sec-fetch-site'] ?? '') === 'cross-site') return false
  return true
}

/**
 * Resolve `<root>/<relative>` while refusing anything that escapes the root.
 * `realpath` is applied to the resolved path so a symlink cannot be used as an exit.
 */
export async function confine(root: string, relative: string): Promise<string | null> {
  const cleaned = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '')
  if (cleaned.startsWith('..') || cleaned.includes('\0')) return null
  const candidate = resolve(join(root, cleaned))
  try {
    const real = await realpath(candidate)
    const realRoot = await realpath(root)
    return real === realRoot || real.startsWith(realRoot + sep) ? real : null
  } catch {
    return null
  }
}

export interface ServeResult { status: number; bytes: number }

/** Serve one file with Range support (single range only, which is all a player needs). */
export async function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  opts: { etag?: string } = {},
): Promise<ServeResult> {
  const stats = await stat(filePath)
  const size = stats.size
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const etag = opts.etag ?? `"${size.toString(16)}-${Math.round(stats.mtimeMs).toString(16)}"`

  const headers: Record<string, string> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
    etag,
  }
  if ((req.headers['if-none-match'] ?? '') === etag) {
    res.writeHead(304, headers).end()
    return { status: 304, bytes: 0 }
  }

  const range = req.headers.range
  if (range === undefined) {
    res.writeHead(200, { ...headers, 'content-length': String(size) })
    if (req.method === 'HEAD') { res.end(); return { status: 200, bytes: 0 } }
    createReadStream(filePath).pipe(res)
    return { status: 200, bytes: size }
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (match === null) {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` }).end()
    return { status: 416, bytes: 0 }
  }
  const start = match[1] === '' ? undefined : Number(match[1])
  const end = match[2] === '' ? undefined : Number(match[2])
  let from: number
  let to: number
  if (start === undefined && end !== undefined) { from = Math.max(0, size - end); to = size - 1 }
  else { from = start ?? 0; to = end === undefined ? size - 1 : Math.min(end, size - 1) }
  if (from > to || from >= size) {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` }).end()
    return { status: 416, bytes: 0 }
  }
  const length = to - from + 1
  res.writeHead(206, {
    ...headers,
    'content-range': `bytes ${from}-${to}/${size}`,
    'content-length': String(length),
  })
  if (req.method === 'HEAD') { res.end(); return { status: 206, bytes: 0 } }
  createReadStream(filePath, { start: from, end: to }).pipe(res)
  return { status: 206, bytes: length }
}
