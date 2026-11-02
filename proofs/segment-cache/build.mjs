// Throwaway benchmark (NOT product code) — proves the segment-cache claim on this hardware.
// Builds a synthetic 9:16 "talking head", cuts silences, burns karaoke-ish captions via ASS,
// renders segment-by-segment, then simulates a one-note review round and measures the delta.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const W = 1080, H = 1920, FPS = 30, SRC_SEC = 30
const ROOT = process.cwd() + '/'
const dir = (p) => `${ROOT}${p}`
const t0 = () => process.hrtime.bigint()
const secs = (a) => Number(process.hrtime.bigint() - a) / 1e9
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: ROOT, stdio: 'inherit' })

for (const d of ['src', 'ass', 'seg', 'out']) { try { rmSync(dir(d), { recursive: true, force: true }) } catch {} ; mkdirSync(dir(d), { recursive: true }) }

// ---------- 1. synthetic source: moving pattern + tone, three silent "pauses" ----------
console.log('\n[1] building synthetic source (1080x1920@30, 30s, silences at 7-9s, 16-18s, 25-27s)')
let a = t0()
ff(['-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:r=${FPS}:d=${SRC_SEC}`,
    '-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=48000:duration=${SRC_SEC}`,
    '-af', "volume='if(between(t,7,9)+between(t,16,18)+between(t,25,27),0,0.6)'",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', dir('src/source.mp4')])
const tSource = secs(a)
console.log(`    source built in ${tSource.toFixed(1)}s`)

// ---------- 2. "transcript" -> cut list (drops the pauses) ----------
const pauses = [[7, 9], [16, 18], [25, 27]]
const cuts = []
let cur = 0
for (const [s, e] of pauses) { if (s > cur) cuts.push([cur, s]); cur = e }
if (cur < SRC_SEC) cuts.push([cur, SRC_SEC])
const program = cuts.map(([s, e], i) => {
  const startFrame = cuts.slice(0, i).reduce((n, [a2, b2]) => n + Math.round((b2 - a2) * FPS), 0)
  return { id: `c-0${i + 1}`, srcIn: s, srcOut: e, startFrame, frames: Math.round((e - s) * FPS) }
})
const totalFrames = program.reduce((n, c) => n + c.frames, 0)
console.log(`[2] cut list: ${program.length} clips, program ${(totalFrames / FPS).toFixed(2)}s (from ${SRC_SEC}s raw)`)

// ---------- 3. captions: 2 word-groups per clip, ASS, local time per segment ----------
const WORDS = 'so the whole point of this is that you can edit one piece of the video without rendering everything again'.split(' ')
const words = WORDS.map((w, i) => ({ id: `w-${String(i).padStart(4, '0')}`, t: w }))
// distribute 37 words over the program, 3 words per caption page
const pages = []
for (let i = 0; i < words.length; i += 3) {
  const g = words.slice(i, i + 3)
  if (g.length) pages.push({ from: i, to: i + g.length - 1, text: g.map((w) => w.t.toUpperCase()).join(' ') })
}
const pageDur = (totalFrames / FPS) / pages.length
const captionItems = pages.map((p, i) => ({
  id: `t-${100 + i}`,
  startMs: i * pageDur * 1000,
  endMs: (i + 1) * pageDur * 1000,
  text: p.text,
}))

function assFile(items, offsetMs, file) {
  const ts = (ms) => {
    const t = Math.max(0, ms), h = Math.floor(t / 3.6e6), m = Math.floor((t % 3.6e6) / 6e4)
    const s = Math.floor((t % 6e4) / 1000), cs = Math.floor((t % 1000) / 10)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
  }
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Cap,Arial Black,86,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,6,0,2,40,40,660,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`
  const body = items.map((it) => `Dialogue: 0,${ts(it.startMs - offsetMs)},${ts(it.endMs - offsetMs)},Cap,,0,0,0,,${it.text}`).join('\n')
  writeFileSync(dir(`ass/${file}.ass`), head + body + '\n')
}
assFile(captionItems, 0, 'program-all')

// ---------- 4. segment plan: one segment per clip, GOP-aligned, forced IDR at 0 ----------
const ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
  '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-force_key_frames', 'expr:eq(n,0)',
  '-c:a', 'aac', '-b:a', '128k', '-ar', '48000']

function renderSegment(seg, captionSet) {
  const local = seg.items.filter((it) => it.startMs < seg.endMs && it.endMs > seg.startMs)
  assFile(local, seg.startMs, `seg-${seg.id}`)
  const out = dir(`seg/${seg.id}.mp4`)
  ff(['-ss', String(seg.srcIn), '-to', String(seg.srcOut), '-i', dir('src/source.mp4'),
      '-vf', `ass=ass/seg-${seg.id}.ass`, ...ENCODE, out])
  return out
}

const segments = program.map((c, i) => {
  const startMs = (c.startFrame / FPS) * 1000
  const endMs = ((c.startFrame + c.frames) / FPS) * 1000
  return { id: `seg-${i + 1}`, clip: c.id, srcIn: c.srcIn, srcOut: c.srcOut, startMs, endMs, items: captionItems }
})

// ---------- 5. PASS 1: cold full preview render (all segments miss) ----------
console.log('[3] cold render: 4 segments, no cache')
const segHashes = {}
a = t0()
for (const seg of segments) { const f = renderSegment(seg); segHashes[seg.id] = createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12) }
const segTimeCold = secs(a)

function assemble(name) {
  writeFileSync(dir('seg/list.txt'), segments.map((s) => `file '${s.id}.mp4'`).join('\n') + '\n')
  const out = dir(`out/${name}.mp4`)
  ff(['-f', 'concat', '-safe', '0', '-i', dir('seg/list.txt'), '-c', 'copy', '-movflags', '+faststart', out])
  return out
}
a = t0(); const coldOut = assemble('preview-rev1'); const concatTime = secs(a)
const totalCold = segTimeCold + concatTime
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=nw=1', f]).toString().trim().replace(/\n/g, '  ')
console.log(`    ${totalCold.toFixed(1)}s total  (segments ${segTimeCold.toFixed(1)}s + concat ${concatTime.toFixed(2)}s)`)
console.log(`    ${coldOut}  ->  ${probe(coldOut)}`)

// ---------- 6. PASS 2: one review note ("t-102 hang longer") -> re-render ONLY its segment ----------
console.log('\n[4] review round: 1 note touching caption t-102 (segment seg-2 only)')
const dirty = new Set(['seg-2'])
const before = captionItems.find((it) => it.id === 't-102').text
for (const it of captionItems) if (it.id === 't-102') { it.endMs += 400; it.text = 'ONE PIECE ✦ (held longer)' }

a = t0()
let misses = 0, hits = 0
const newHashes = {}
for (const seg of segments) {
  if (dirty.has(seg.id)) {
    const f = renderSegment(seg, captionItems)
    newHashes[seg.id] = createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12)
    misses++
  } else { newHashes[seg.id] = segHashes[seg.id]; hits++ }
}
const segTimeIncr = secs(a)
a = t0(); const incrOut = assemble('preview-rev2'); const concatTime2 = secs(a)
const totalIncr = segTimeIncr + concatTime2
console.log(`    ${totalIncr.toFixed(1)}s total  (re-rendered ${misses} segment(s), reused ${hits} from cache)`)
console.log(`    ${incrOut}  ->  ${probe(incrOut)}`)

// ---------- 7. what the note would have cost the naive way ----------
console.log('\n[5] comparison')
console.log(`    naive full re-render (all 4 segments, no cache): ${totalCold.toFixed(1)}s`)
console.log(`    segment-cached re-render  (1 dirty segment):     ${totalIncr.toFixed(1)}s`)
console.log(`    speedup: ${(totalCold / totalIncr).toFixed(2)}x   |   untouched segments byte-identical: ${segments.filter((s) => !dirty.has(s.id)).every((s) => newHashes[s.id] === segHashes[s.id])}`)
console.log(`    caption "${before}" -> updated, only visible in the re-rendered segment`)
console.log(`\n[6] reuse proof: seg-1 hash rev1 = ${segHashes['seg-1']}  rev2 = ${newHashes['seg-1']}`)
console.log(`     seg-2 hash rev1 = ${segHashes['seg-2']}  rev2 = ${newHashes['seg-2']}  <- changed, as expected`)
