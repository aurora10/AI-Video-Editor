/**
 * `pnpm font-gate` — does each bundled font actually draw this project's script?
 *
 * A font that lacks Cyrillic does not fail loudly: the renderer silently substitutes another
 * face, and the caption style you chose quietly is not the one on screen. This gate renders a
 * probe string and an all-`?` control *through the real caption pipeline*; if the two are
 * pixel-identical the font is missing the glyphs. PSNR, not opinion.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FONT_LIBRARY, FONT_DIR } from '../packages/host-render/src/index.js'

const FONTS = FONT_LIBRARY

const PROBE = 'Фундаментальная протестантская вышесказанного Ёё'
const CONTROL = '????????????????????????????????????????'
const W = 1080, H = 300

function renderText(fontFile: string, dir: string, text: string, out: string): boolean {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=1`,
    '-vf', `drawtext=fontfile='${fontFile}':text='${text}':fontsize=64:fontcolor=white:x=20:y=100`,
    '-frames:v', '1', join(dir, out)], { encoding: 'utf8' })
  return r.status === 0 && existsSync(join(dir, out))
}

/** PSNR between two PNGs; identical images have no PSNR output (treated as infinite). */
function psnr(a: string, b: string): number {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-filter_complex', '[0:v][1:v]psnr', '-f', 'null', '-'], { encoding: 'utf8' })
  const m = /average:([\d.]+|inf)/.exec(r.stderr)
  if (m === null) return Infinity
  return m[1] === 'inf' ? Infinity : Number(m[1])
}

const dir = await mkdtemp(join(tmpdir(), 'fontgate-'))
const results: { key: string; family: string; ok: boolean; why: string; psnr: number }[] = []
try {
  for (const f of FONTS) {
    const path = join(FONT_DIR, f.file)
    if (!existsSync(path)) { results.push({ key: f.key, family: f.family, ok: false, why: 'missing file', psnr: 0 }); continue }
    const probeOk = renderText(path, dir, PROBE, `${f.key}-probe.png`)
    const controlOk = renderText(path, dir, CONTROL, `${f.key}-control.png`)
    if (!probeOk || !controlOk) { results.push({ key: f.key, family: f.family, ok: false, why: 'render failed', psnr: 0 }); continue }
    const p = psnr(join(dir, `${f.key}-probe.png`), join(dir, `${f.key}-control.png`))
    // Different glyph shapes -> low PSNR. Identical output -> the font has no Cyrillic and both
    // strings fell back to the same substitute.
    const ok = Number.isFinite(p) && p < 26
    results.push({ key: f.key, family: f.family, ok, why: ok ? 'draws Cyrillic' : `no Cyrillic (PSNR ${p.toFixed(1)} vs control)`, psnr: p })
  }
} finally {
  await rm(dir, { recursive: true, force: true })
}

console.log('\n  font coverage gate — Cyrillic\n')
for (const r of results) {
  console.log(`  ${r.ok ? '✔' : '✘'} ${r.key.padEnd(11)} ${r.family.padEnd(13)} PSNR ${String(Number.isFinite(r.psnr) ? r.psnr.toFixed(1) : 'inf').padStart(6)}  ${r.why}`)
}
const usable = results.filter((r) => r.ok).map((r) => r.key)
console.log(`\n  usable: ${usable.join(', ') || 'none'}`)
await writeFile(join(FONT_DIR, 'gate.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results, usable }, null, 2) + '\n')
if (usable.length === 0) process.exit(1)
