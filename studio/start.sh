#!/usr/bin/env bash
# Start the studio. One command, no flags, no environment variables to remember.
#
#   ./start.sh          boot the server and print the address
#
# What it does: finds the DSH checkout, points the profile at this folder's own harness home
# (studio/.dsh-home), refreshes the agent's skill from packages/skill, and boots on port 3099.
# If the server is already running it says so instead of starting a second one.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port=3099
url="http://127.0.0.1:${port}"

# --- is it already running? -------------------------------------------------
if curl -s -m 2 -o /dev/null "${url}/" 2>/dev/null; then
  echo "Already running — nothing to start."
  echo "  open  ${url}"
  echo "  stop  Ctrl+C in the terminal that started it (or: pkill -f 'dsh --profile studio')"
  exit 0
fi

# --- find the deepseek-harness checkout -------------------------------------
find_harness() {
  local candidate
  for candidate in \
    "${DSH_REPO:-}" \
    "${here}/../../../deepseek-harness" \
    "${here}/../../deepseek-harness" \
    "${HOME}/Desktop/deepseek-harness" \
    "${HOME}/deepseek-harness"
  do
    if [ -n "${candidate}" ] && [ -f "${candidate}/package.json" ] && grep -q '"name"' "${candidate}/package.json" 2>/dev/null; then
      (cd "${candidate}" && [ -x node_modules/.bin/dsh ] || [ -d packages/boot ]) && { echo "${candidate}"; return 0; }
    fi
  done
  return 1
}

if ! harness="$(find_harness)"; then
  cat >&2 <<'MSG'
Cannot find the deepseek-harness checkout.

Tell me where it is once:
    DSH_REPO=/path/to/deepseek-harness ./start.sh

or permanently, by adding that line to your shell profile.
MSG
  exit 1
fi

echo "harness:  ${harness}"
echo "profile:  studio"
echo "home:     ${here}/.dsh-home"
echo

# --- first run on a new machine --------------------------------------------
# The profile is generated state (its package.json holds absolute link paths), so a fresh clone or a
# moved folder has none. This recreates it and prints nothing when there is nothing to do.
(cd "${here}" && node scripts/bootstrap-profile.mjs) || {
  echo "could not prepare the studio profile — see the error above" >&2
  exit 1
}

# --- refresh the agent's instructions --------------------------------------
# The skill is copied, not linked, so it must be refreshed after edits. Cheap and silent on failure:
# a stale skill is a smaller problem than a server that will not boot.
(cd "${here}" && node scripts/install-skill.mjs >/dev/null 2>&1) || \
  echo "note: could not refresh the skill (the agent may be a version behind)"

# --- build the browser half of the pane ------------------------------------
# lib/ is build output and gitignored, so a fresh clone has none and the Studio tab would never appear.
# Failing here is fatal: a server without the pane is a worse experience than an honest error.
if ! (cd "${here}" && node scripts/build-client.mjs >/dev/null 2>&1); then
  echo "could not build the editor pane — run 'node scripts/build-client.mjs' in studio/ to see why" >&2
  exit 1
fi

echo "starting… this takes about 10 seconds."
echo

cd "${harness}"
export DSH_HOME="${here}/.dsh-home"
export DSH_VIDEO_WORKSPACE="${here}"

exec pnpm dsh --profile studio --no-open
