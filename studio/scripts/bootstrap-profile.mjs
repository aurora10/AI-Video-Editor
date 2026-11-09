/**
 * Make sure the `studio` DSH profile exists and points at THIS checkout.
 *
 * The profile lives under DSH_HOME (studio/.dsh-home), which is gitignored because it is generated,
 * machine-specific state: its package.json holds absolute `link:` paths. So a fresh clone — or a
 * checkout that moved — has no profile, and `dsh --profile studio` would fail with a confusing error
 * before the user sees anything. This script recreates what `dsh plugin add` + the two manual edits in
 * README.md produce, and is safe to run every time: it rewrites only when the content differs.
 *
 * Run from studio/. Prints one line when it did work, nothing when there was nothing to do.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const studioRoot = resolve('.')
if (!existsSync(join(studioRoot, 'packages', 'bundle'))) {
  console.error('bootstrap-profile: run this from the studio/ directory')
  process.exit(2)
}

// An existing local home wins over an inherited DSH_HOME: on this machine ~/.dsh is not writable, and
// a bare shell often exports DSH_HOME=~/.dsh, which would otherwise send the profile to the wrong place.
const localHome = join(studioRoot, '.dsh-home')
const dshHome = existsSync(localHome) ? localHome : (process.env.DSH_HOME ?? localHome)
const profileDir = join(dshHome, 'profiles', 'studio')
const manifestPath = join(profileDir, 'package.json')

const manifest = {
  name: 'dsh-profile-studio',
  private: true,
  dependencies: {
    'dsh-studio': `link:${join(studioRoot, 'packages', 'bundle')}`,
    'dsh-video-client-pane': `link:${join(studioRoot, 'packages', 'client-pane')}`,
    'dsh-video-host-server': `link:${join(studioRoot, 'packages', 'host-server')}`,
  },
  dsh: {
    profile: {
      // @deepseek-ai/dsh-base + dsh-web-app are in-box bundles (no install needed); dsh-studio is ours.
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-studio'],
    },
  },
}

const wanted = JSON.stringify(manifest, null, 2) + '\n'
const current = existsSync(manifestPath) ? await readFile(manifestPath, 'utf8') : ''
const changed = current !== wanted
const needsInstall = changed || !existsSync(join(profileDir, 'node_modules', 'dsh-studio'))

await mkdir(profileDir, { recursive: true })
if (changed) await writeFile(manifestPath, wanted)

// Support files the loader expects next to the manifest. Written only when absent so a hand-edited
// patch layer (the user's own overrides) is never overwritten.
const support = {
  'pnpm-workspace.yaml': 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
  'cordis.yml': '# dsh profile root — an empty entry list. The tree is composed as patches:\n# each bundle in package.json\'s dsh.profile.bundles, then cordis.patch.yml, then any\n# --patch overlays. Edit cordis.patch.yml, not this file.\n[]\n',
  'cordis.patch.yml': '# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n',
}
for (const [name, content] of Object.entries(support)) {
  const path = join(profileDir, name)
  if (!existsSync(path)) await writeFile(path, content)
}

if (needsInstall) {
  process.stdout.write('first run: preparing the studio profile… ')
  // A linked package does not bring its own deps into the profile's resolution root, so the profile
  // needs its own install — this is the part README.md describes as a manual step.
  const result = spawnSync('pnpm', ['install', '--prefer-offline'], {
    cwd: profileDir,
    encoding: 'utf8',
    env: { ...process.env },
  })
  if (result.status !== 0) {
    console.error('\nbootstrap-profile: pnpm install failed in the profile')
    console.error((result.stderr ?? '').split('\n').slice(-8).join('\n'))
    process.exit(1)
  }
  console.log('done')
} else if (changed) {
  console.log('profile: relinked to this checkout (paths had moved)')
}
