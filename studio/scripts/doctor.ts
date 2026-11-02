/**
 * `pnpm doctor` — what this machine can and cannot do.
 *
 * Exits non-zero when a hard requirement for the T0 render path is missing, so a
 * broken environment is a red step in the build plan rather than a mystery three
 * hours later.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir, platform, release, arch, availableParallelism, freemem, totalmem } from 'node:os'

type Status = 'ok' | 'warn' | 'fail'

const rows: { check: string; status: Status; detail: string }[] = []
const add = (check: string, status: Status, detail: string) => rows.push({ check, status, detail })

function tryExec(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim()
  } catch {
    return null
  }
}

// --- runtime ---------------------------------------------------------------
const nodeMajor = Number(process.versions.node.split('.')[0])
add('node', nodeMajor >= 22 ? 'ok' : 'fail', `v${process.versions.node} (need >=22.19)`)

// --- ffmpeg ----------------------------------------------------------------
const ffVersion = tryExec('ffmpeg', ['-version'])?.split('\n')[0] ?? null
add('ffmpeg', ffVersion ? 'ok' : 'fail', ffVersion ?? 'not found on PATH')

const filters = ffVersion ? (tryExec('ffmpeg', ['-hide_banner', '-filters']) ?? '') : ''
const REQUIRED_FILTERS = ['ass', 'subtitles', 'overlay', 'zoompan', 'sidechaincompress', 'loudnorm', 'silencedetect'] as const
const missingFilters = REQUIRED_FILTERS.filter((f) => !new RegExp(`^\\s*\\.?\\s*${f}\\s`, 'm').test(filters) && !filters.includes(` ${f} `))
add('ffmpeg filters', missingFilters.length ? 'fail' : 'ok', missingFilters.length ? `missing: ${missingFilters.join(', ')}` : REQUIRED_FILTERS.join(' '))

const encoders = ffVersion ? (tryExec('ffmpeg', ['-hide_banner', '-encoders']) ?? '') : ''
const hwEnc = ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_vaapi'].filter((e) => encoders.includes(e))
add('libx264', encoders.includes('libx264') ? 'ok' : 'fail', encoders.includes('libx264') ? 'present' : 'missing — the segment encoder needs it')
add('hw encode', hwEnc.length ? 'ok' : 'warn', hwEnc.length ? hwEnc.join(', ') : 'software only')

// --- chrome ----------------------------------------------------------------
const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
const chromePath = CHROME_PATHS.find((p) => existsSync(p))
const chromeVersion = chromePath ? tryExec(chromePath, ['--version']) : null
add('chrome', chromeVersion ? 'ok' : 'fail', chromeVersion ?? 'not found (needed for the T1/Chromium tier)')

// --- fonts -----------------------------------------------------------------
const FONT_DIRS = ['/System/Library/Fonts/Supplemental', '/System/Library/Fonts', '/Library/Fonts', `${homedir()}/Library/Fonts`]
const localFonts = existsSync('fixtures/fonts') ? readdirSync('fixtures/fonts').filter((f) => /\.(ttf|otf|woff2?)$/i.test(f)) : []
const systemFonts = FONT_DIRS.filter((d) => existsSync(d)).reduce((n, d) => n + readdirSync(d).filter((f) => /\.(ttf|ttc|otf)$/i.test(f)).length, 0)
add('fonts (project)', localFonts.length ? 'ok' : 'warn', localFonts.length ? localFonts.join(', ') : 'none in fixtures/fonts — T1 determinism needs pinned fonts')
add('fonts (system)', systemFonts > 0 ? 'ok' : 'warn', `${systemFonts} faces visible; usable for T0/libass previews only`)

// --- hardware --------------------------------------------------------------
const totalGb = Math.round(totalmem() / 1024 ** 3)
const freeGb = Math.round(freemem() / 1024 ** 3)
const cores = availableParallelism()
add('cpu', cores >= 4 ? 'ok' : 'warn', `${cores} threads · ${platform()}-${arch()} ${release()}`)
add('memory', totalGb >= 16 ? 'ok' : 'warn', `${totalGb} GB total, ${freeGb} GB free → Chromium workers: ${Math.max(1, Math.min(2, Math.floor(totalGb / 3)))}`)
const dfLine = tryExec('df', ['-k', '.'])?.split('\n')[1]?.split(/\s+/) ?? []
const freeDiskGb = dfLine[3] ? Math.round(Number(dfLine[3]) / 1024 / 1024) : null
add('disk', freeDiskGb === null ? 'warn' : freeDiskGb > 40 ? 'ok' : 'warn', freeDiskGb === null ? 'unknown' : `${freeDiskGb} GB free (proxies + segment cache need >40)`)

// --- ASR (hosted; no local whisper needed) ---------------------------------
const ASR_KEYS = ['ELEVENLABS_API_KEY', 'DEEPGRAM_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ASSEMBLYAI_API_KEY']
const envKeys = ASR_KEYS.filter((k) => process.env[k])
const credFile = `${homedir()}/.dsh/.credentials.yaml`
const creds = existsSync(credFile) ? tryExec('cat', [credFile]) ?? '' : ''
const fileKeys = ASR_KEYS.filter((k) => creds.includes(k))
add('asr key', envKeys.length || fileKeys.length ? 'ok' : 'warn', [...new Set([...envKeys, ...fileKeys])].join(', ') || 'no key in env or ~/.dsh/.credentials.yaml — blocks step B2')

// --- media inputs ----------------------------------------------------------
const incoming = existsSync('fixtures/incoming') ? readdirSync('fixtures/incoming').filter((f) => /\.(mp4|mov|m4v|mkv)$/i.test(f)) : []
add('real footage', incoming.length ? 'ok' : 'warn', incoming.length ? incoming.join(', ') : 'none — drop a clip into fixtures/incoming/ for real-footage validation')
if (incoming[0]) {
  const p = `fixtures/incoming/${incoming[0]}`
  const probe = tryExec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,duration', '-of', 'csv=p=0', p])
  add('  ↳ probe', probe ? 'ok' : 'warn', probe ?? 'ffprobe failed')
}

// --- DSH -------------------------------------------------------------------
const dshGlobal = tryExec('dsh', ['--version'])
add('dsh cli', dshGlobal ? 'ok' : 'warn', dshGlobal ?? 'no global CLI — use `pnpm dsh` from the checkout')

// --- report ----------------------------------------------------------------
const icon = (s: Status) => (s === 'ok' ? '✔' : s === 'warn' ? '!' : '✘')
const width = Math.max(...rows.map((r) => r.check.length))
console.log('\nDSH Studio — environment\n')
for (const r of rows) console.log(`  ${icon(r.status)} ${r.check.padEnd(width)}  ${r.detail}`)
console.log('\nRender plan implied by this machine:')
console.log(`  T0 (ffmpeg/libass):  enabled${hwEnc.length ? ' + hardware encode' : ' (software encode)'}`)
console.log(`  T1 (chromium):       ${chromeVersion ? `enabled, ${Math.max(1, Math.min(2, Math.floor(totalGb / 3)))} worker(s)` : 'DISABLED — no chrome'}`)
console.log(`  preview resolution:  ${totalGb < 12 ? '540p (memory-constrained)' : '720p'}`)
const failures = rows.filter((r) => r.status === 'fail')
console.log(`\n${failures.length === 0 ? 'Hard requirements satisfied.' : `${failures.length} hard failure(s): ${failures.map((f) => f.check).join(', ')}`}\n`)
process.exit(failures.length === 0 ? 0 : 1)
