/**
 * Cheap content fingerprint for cache keys.
 *
 * A full sha256 of a 3 GB source costs 20–40 s on this hardware and we would pay it
 * on every run. The head+tail+size digest is fast, stable for real footage, and
 * documents exactly what it covers so nobody mistakes it for a cryptographic
 * integrity claim.
 */
import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'

const CHUNK = 4 * 1024 * 1024

export interface Fingerprint {
  /** sha256 over: size, the first 4 MiB, and the last 4 MiB. */
  digest: string
  bytes: number
  /** mtime is recorded for humans, never used as identity. */
  mtimeMs: number
  ms: number
}

export async function fingerprint(path: string): Promise<Fingerprint> {
  const started = Date.now()
  const st = await stat(path)
  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(Math.min(CHUNK, st.size))
    await handle.read(head, 0, head.length, 0)
    const tailLength = Math.min(CHUNK, Math.max(0, st.size - head.length))
    const tail = Buffer.alloc(tailLength)
    if (tailLength > 0) await handle.read(tail, 0, tailLength, st.size - tailLength)
    const hash = createHash('sha256').update(String(st.size)).update(head).update(tail)
    return { digest: hash.digest('hex'), bytes: st.size, mtimeMs: Math.round(st.mtimeMs), ms: Date.now() - started }
  } finally {
    await handle.close()
  }
}
