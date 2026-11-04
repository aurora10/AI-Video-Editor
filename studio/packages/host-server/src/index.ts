/**
 * The HTTP surface the Studio pane talks to.
 *
 * Deliberately its own routes rather than a DSH `/remote` namespace: adding one of those
 * requires editing a build-time array inside the harness checkout, and this product is
 * out-of-tree. One prefix (`/video`) carries three things: `/video/api/*` for JSON commands,
 * `/video/media/*` for Range-capable media, and `/video/events` for push updates.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { confine, isTrustedLocalRequest, serveFile } from './media.js'
import { OPTIONS, readProject, writeProjectSettings, type RenderSettings } from './settings.js'
import { addNote, deleteNote, readNotes, readTimeline } from './notes.js'
import { askAgent, type AgentsLike } from './bridge.js'

export { OPTIONS, DEFAULT_SETTINGS, readProject, writeProjectSettings } from './settings.js'
export type { RenderSettings, OptionSpec } from './settings.js'

export interface HostServerConfig {
  /** Absolute path to the workspace root that contains `projects/`. */
  workspaceRoot: string
  /** Where the pane's renders are written. */
  outputDir?: string
}

interface WebRoute { kind: 'prefix' | 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }
interface WebServerLike { register(route: WebRoute): () => void }

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(payload)) })
  res.end(payload)
}

const readBody = (req: IncomingMessage, limit = 1_000_000): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString()
      if (data.length > limit) reject(new Error('body too large'))
    })
    req.on('end', () => {
      if (data === '') return resolve({})
      try { resolve(JSON.parse(data)) } catch (e) { reject(e instanceof Error ? e : new Error(String(e))) }
    })
    req.on('error', reject)
  })

/** One running render at a time per project; the pane polls `state` for progress. */
interface RenderJob { slug: string; label: string; startedAt: number; status: 'running' | 'done' | 'failed'; log: string[]; outputUrl?: string; error?: string }
const jobs = new Map<string, RenderJob>()

export const name = 'dsh-video-host-server'
export const inject = ['webServer', 'agents']

export function apply(
  ctx: { webServer: WebServerLike; effect: (fn: () => void, label?: string) => void; agents?: AgentsLike },
  config: HostServerConfig,
): void {
  const projectsRoot = join(config.workspaceRoot, 'projects')
  const outputDir = config.outputDir ?? join(config.workspaceRoot, 'out')

  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!isTrustedLocalRequest(req)) { json(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'loopback requests only' } }); return false }
    return true
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname

    // ---- media (Range) ----------------------------------------------------
    if (path.startsWith('/video/media/')) {
      if (!guard(req, res)) return
      const rest = decodeURIComponent(path.slice('/video/media/'.length))
      const [slug, ...relative] = rest.split('/')
      if (slug === undefined || relative.length === 0) { json(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'expected /video/media/<project>/<path>' } }); return }
      // `out/...` addresses the render output directory; everything else is inside the
      // project folder. Encoding this in the path avoids `..` in URLs, which used to work
      // only because the confinement cleaner happened to strip it.
      const joined = relative.join('/')
      const file = joined.startsWith('out/')
        ? await confine(outputDir, joined.slice(4))
        : await confine(join(projectsRoot, slug), joined)
      if (file === null || !existsSync(file)) { json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `no such media: ${rest}` } }); return }
      await serveFile(req, res, file)
      return
    }

    // ---- api --------------------------------------------------------------
    if (!path.startsWith('/video/api/')) { json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: path } }); return }
    if (!guard(req, res)) return
    const method = path.slice('/video/api/'.length)

    try {
      if (method === 'projects' && req.method === 'GET') {
        const entries = await readdir(projectsRoot, { withFileTypes: true }).catch(() => [])
        const projects = entries.filter((e) => e.isDirectory()).map((e) => ({ slug: e.name }))
        json(res, 200, { ok: true, value: { projects } })
        return
      }

      if (method === 'state' && req.method === 'GET') {
        const slug = url.searchParams.get('project')
        if (slug === null) { json(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'project query parameter required' } }); return }
        const record = await readProject(projectsRoot, slug)
        const job = jobs.get(slug)
        // The render this project last produced THROUGH THE PANE, recorded when it finished.
        // A filename heuristic ("newest mp4 that is not called *nocaps*") showed a caption-less
        // verification control as if it were the result, which is exactly the bug this replaces.
        const recorded = (record as { lastRender?: { file: string; at: string; captions: boolean; settings?: Record<string, unknown> } }).lastRender
        const latest = recorded !== undefined && existsSync(join(outputDir, recorded.file))
          ? { file: recorded.file, mtimeMs: (await stat(join(outputDir, recorded.file))).mtimeMs }
          : undefined
        json(res, 200, {
          ok: true,
          value: {
            project: { slug, id: record.id, name: record.name },
            settings: record.settings,
            options: OPTIONS,
            timeline: await readTimeline(projectsRoot, slug),
            notes: await readNotes(projectsRoot, slug),
            render: latest === undefined
              ? null
              : {
                  url: `/video/media/${slug}/out/${latest.file}`,
                  file: latest.file,
                  mtimeMs: latest.mtimeMs,
                  stale: JSON.stringify(recorded?.settings ?? {}) !== JSON.stringify(record.settings),
                },
            job: job ?? null,
          },
        })
        return
      }

      if (method === 'assets' && req.method === 'GET') {
        const slug = url.searchParams.get('project')
        if (slug === null) { json(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'project required' } }); return }
        const dir = join(projectsRoot, slug, 'assets')
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
        const assets: { path: string; name: string; bytes: number; kind: 'image' | 'video' | 'other' }[] = []
        for (const e of entries) {
          if (!e.isFile()) continue
          const full = join(dir, e.name)
          const size = (await stat(full).catch(() => null))?.size ?? 0
          const ext = e.name.slice(e.name.lastIndexOf('.')).toLowerCase()
          const kind = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? 'image' : ['.mp4', '.mov', '.m4v'].includes(ext) ? 'video' : 'other'
          assets.push({ path: `projects/${slug}/assets/${e.name}`, name: e.name, bytes: size, kind })
        }
        json(res, 200, { ok: true, value: { assets } })
        return
      }

      if (method === 'notes' && req.method === 'GET') {
        const slug = url.searchParams.get('project')
        if (slug === null) { json(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'project required' } }); return }
        const notes = await readNotes(projectsRoot, slug)
        json(res, 200, { ok: true, value: { notes } })
        return
      }

      if (method === 'notes' && req.method === 'POST') {
        const body = (await readBody(req)) as {
          project?: string; kind?: string; progStartMs?: number; progEndMs?: number; text?: string; asset?: string
        }
        if (body.project === undefined || body.kind === undefined || body.progStartMs === undefined) {
          json(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'project, kind and progStartMs required' } })
          return
        }
        const note = await addNote(projectsRoot, body.project, {
          kind: body.kind, progStartMs: body.progStartMs, progEndMs: body.progEndMs ?? body.progStartMs + 2000,
          text: body.text ?? '', ...(body.asset === undefined ? {} : { asset: body.asset }),
        })
        json(res, 200, { ok: true, value: { note } })
        return
      }

      if (method === 'notes/delete' && req.method === 'POST') {
        const body = (await readBody(req)) as { project?: string; id?: string }
        if (body.project === undefined || body.id === undefined) { json(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'project and id required' } }); return }
        await deleteNote(projectsRoot, body.project, body.id)
        json(res, 200, { ok: true, value: { deleted: body.id } })
        return
      }

      if (method === 'ask' && req.method === 'POST') {
        const body = (await readBody(req)) as { project?: string; sessionId?: string; request?: string }
        if (body.project === undefined || body.sessionId === undefined || body.request === undefined) {
          json(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'project, sessionId and request required' } })
          return
        }
        if (ctx.agents === undefined) {
          json(res, 503, { ok: false, error: { code: 'NO_AGENTS', message: 'the agent registry is not available in this deployment' } })
          return
        }
        const record = await readProject(projectsRoot, body.project)
        const result = askAgent(ctx.agents, body.sessionId, {
          projectSlug: body.project,
          projectRoot: join(projectsRoot, body.project),
          request: body.request,
          settings: record.settings as RenderSettings,
          timeline: await readTimeline(projectsRoot, body.project),
          openNotes: (await readNotes(projectsRoot, body.project)).filter((n) => n.status !== 'done').length,
        })
        json(res, result.ok ? 202 : 409, result.ok
          ? { ok: true, value: { submitted: true } }
          : { ok: false, error: { code: 'NO_AGENT', message: result.reason ?? 'unavailable' } })
        return
      }

      if (method === 'settings' && req.method === 'POST') {
        const body = (await readBody(req)) as { project?: string; patch?: Partial<RenderSettings> }
        if (body.project === undefined || body.patch === undefined) { json(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'project and patch required' } }); return }
        const { settings, adjustments } = await writeProjectSettings(projectsRoot, body.project, body.patch)
        json(res, 200, { ok: true, value: { settings, adjustments } })
        return
      }

      if (method === 'render' && req.method === 'POST') {
        const body = (await readBody(req)) as { project?: string; from?: string; to?: string; label?: string }
        if (body.project === undefined) { json(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'project required' } }); return }
        const slug = body.project
        const running = jobs.get(slug)
        // Forget a finished job that nobody will ask about again, so the map cannot grow.
        if (running !== undefined && running.status !== 'running' && Date.now() - running.startedAt > 60 * 60_000) jobs.delete(slug)
        if (running !== undefined && running.status === 'running') { json(res, 409, { ok: false, error: { code: 'BUSY', message: 'a render is already running for this project' } }); return }
        const settings = (await readProject(projectsRoot, slug)).settings as RenderSettings
        const label = body.label ?? `render-${Date.now()}`
        const job: RenderJob = { slug, label, startedAt: Date.now(), status: 'running', log: [] }
        jobs.set(slug, job)

        const args = ['-s', 'tsx', 'scripts/render-clip.ts', slug,
          '--from', body.from ?? '4:47', '--to', body.to ?? '5:47', '--label', label,
          '--pace', settings.pace,
          '--fillers', settings.mumbles,
          '--orientation', settings.orientation,
          '--background', settings.background,
          '--graphics', settings.graphics === 'none' ? 'off' : 'on',
          '--font', settings.font,
          ...(settings.voicePolish ? [] : ['--no-voice-polish']),
          ...(settings.captions ? ['--captions', settings.captionStyle === 'plain' ? 'none' : settings.captionStyle] : ['--no-captions'])]
        const child = spawn('pnpm', args, { cwd: config.workspaceRoot, env: { ...process.env } })
        const onData = (chunk: Buffer): void => {
          for (const line of chunk.toString().split('\n')) {
            if (line.trim() !== '') { job.log.push(line); if (job.log.length > 200) job.log.shift() }
          }
        }
        child.stdout.on('data', onData)
        child.stderr.on('data', onData)
        // A spawn failure (pnpm missing, bad cwd) emits 'error'; without a listener it throws
        // inside the host process.
        child.on('error', (error) => {
          job.status = 'failed'
          job.error = `failed to start the renderer: ${String(error)}`
        })
        // Watchdog: an ffmpeg that hangs would otherwise leave the pane at "Rendering…" for ever.
        const watchdog = setTimeout(() => {
          if (job.status !== 'running') return
          job.status = 'failed'
          job.error = 'render exceeded the 15 minute limit and was killed'
          try { child.kill('SIGKILL') } catch { /* already gone */ }
        }, 15 * 60_000)
        child.on('close', (code) => {
          clearTimeout(watchdog)
          if (job.status === 'failed') return
          job.status = code === 0 ? 'done' : 'failed'
          if (code === 0) {
            job.outputUrl = `/video/media/${slug}/out/${slug}-${label}.mp4`
            // Record the deliverable (and the settings that produced it) so the pane shows the
            // right file and can tell whether the recorded render still matches the settings.
            void (async () => {
              try {
                const path = join(projectsRoot, slug, 'project.json')
                const fresh = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
                fresh.lastRender = { file: `${slug}-${label}.mp4`, label, at: new Date().toISOString(), captions: settings.captions, settings }
                await writeFile(path, JSON.stringify(fresh, null, 2) + '\n')
              } catch { /* a missing record must not fail the render result */ }
            })()
          } else job.error = job.log.slice(-5).join(' | ')
        })
        json(res, 202, { ok: true, value: { job: { slug, label, status: job.status } } })
        return
      }

      json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `no such method: ${method}` } })
    } catch (error) {
      json(res, 400, { ok: false, error: { code: 'FAILED', message: error instanceof Error ? error.message : String(error) } })
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/video', handler }), 'dsh-video: /video routes')
}
