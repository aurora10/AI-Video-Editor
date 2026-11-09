/**
 * Install the video-editing skill into the harness home so a fresh agent session has instructions.
 *
 * Copies rather than symlinks: the harness rescans on file change, and a symlink into the repo can
 * be confusing to reason about when the repo moves. Re-run after editing the skill.
 */
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Where the running dev server keeps its harness home. On this machine ~/.dsh is not writable and
// the studio profile uses a home inside the repo, so an existing local home wins even over an
// inherited DSH_HOME (a bare `pnpm install-skill` inherits DSH_HOME=~/.dsh from the shell).
const localHome = resolve('.dsh-home')
const home = existsSync(localHome) ? localHome : (process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh'))
const target = join(home, 'skills', 'video-editing')
const source = resolve('packages/skill/video-editing')

if (!existsSync(source)) {
  console.error(`no skill at ${source} — run this from the studio/ directory`)
  process.exit(2)
}

await rm(target, { recursive: true, force: true })
await mkdir(join(home, 'skills'), { recursive: true })
await cp(source, target, { recursive: true })
console.log(`✔ installed ${target}`)
console.log(`  the agent sees it as skill "video-editing"; start a NEW session for it to be in the catalogue`)
