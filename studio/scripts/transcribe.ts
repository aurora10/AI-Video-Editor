/**
 * `pnpm transcribe <project> [--language en] [--force]`
 *
 * Runs the ASR seam against the project's 16 kHz mono extraction and caches the result
 * at `analysis/transcript.<srcId>.json`, keyed by audio fingerprint + provider + model.
 * A second run with an unchanged audio file makes zero network calls.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fingerprint, OpenAiWhisper, projectPaths } from '../packages/host-ingest/src/index.js'
import { Transcript } from '@dsh-video/core'

const args = process.argv.slice(2)
const slug = args.find((a) => !a.startsWith('--'))
if (slug === undefined) { console.error('usage: pnpm transcribe <project-slug> [--language en] [--force]'); process.exit(2) }
const langIdx = args.indexOf('--language')
const language = langIdx === -1 ? undefined : args[langIdx + 1]
const force = args.includes('--force')

const root = resolve('projects', slug)
const paths = projectPaths(root)
if (!existsSync(paths.record)) {
  console.error(`no project record at ${paths.record} — run \`pnpm ingest\` first (it writes the record before building proxies)`)
  process.exit(2)
}
const record = JSON.parse(await readFile(paths.record, 'utf8'))
const source = record.sources[0]
const audioPath = source.proxies.audioAsr
if (!existsSync(audioPath)) { console.error(`missing ${audioPath} — run \`pnpm ingest\` first`); process.exit(2) }

const apiKey = process.env.OPENAI_API_KEY
const audioFp = await fingerprint(audioPath)
const cachePath = join(paths.analysis, `transcript.${source.id}.json`)

if (!force && existsSync(cachePath)) {
  const cached = Transcript.safeParse(JSON.parse(await readFile(cachePath, 'utf8')))
  if (cached.success && cached.data.audioFingerprint === audioFp.digest) {
    const w = cached.data.words
    console.log(`cached: ${w.length} words, ${cached.data.segments.length} segments, model ${cached.data.model}, cost $${cached.data.costUsd ?? 0}`)
    console.log(`  speech span ${(w[0]!.startMs / 1000).toFixed(1)}s → ${(w[w.length - 1]!.endMs / 1000).toFixed(1)}s`)
    process.exit(0)
  }
  console.log('cache stale (audio fingerprint changed) — re-transcribing')
}

if (apiKey === undefined) {
  console.error('OPENAI_API_KEY is not set. Put it in studio/.env or the environment, then re-run.')
  console.error('  (the audio is already prepared: ' + audioPath + ', ' + (audioFp.bytes / 1024 ** 2).toFixed(1) + ' MB)')
  process.exit(3)
}

let requests = 0
const provider = new OpenAiWhisper({ apiKey, onRequest: () => { requests += 1 }, ...(language === undefined ? {} : {}) })
console.log(`transcribing ${(audioFp.bytes / 1024 ** 2).toFixed(1)} MB → ${provider.model} …`)
const started = Date.now()
const out = await provider.transcribe({
  audioPath, srcId: source.id, audioFingerprint: audioFp.digest, durationMs: source.durationMs,
  ...(language === undefined ? {} : { language }),
})
await writeFile(cachePath, JSON.stringify(out.transcript, null, 1) + '\n')
const w = out.transcript.words
console.log(`  ok in ${((Date.now() - started) / 1000).toFixed(1)}s · ${w.length} words · ${out.transcript.segments.length} segments · requests ${requests} · cost $${out.transcript.costUsd}`)
console.log(`  speech ${(w[0]!.startMs / 1000).toFixed(1)}s → ${(w[w.length - 1]!.endMs / 1000).toFixed(1)}s · language ${out.transcript.language}`)
console.log(`  → ${cachePath}`)
