#!/bin/bash
# Double-click to open Mindscape.
#  - First checks GitHub for an update (a fast-forward git pull; skipped if
#    anything in this folder was changed by hand). After an update, a running
#    server is restarted so the new version is what opens.
#  - Already running → just opens the browser.
#  - Otherwise: checks Node, starts the prebuilt server (release/) in the
#    background, opens the browser, and closes this window.
#  - On the dev Mac only (where node_modules exists), it first rebuilds
#    release/ if the code changed. The work Mac never builds or installs.
#
# Everything is inside main(), which bash reads in full before running it, so a
# git pull that rewrites this file can't trip up the copy that's running.

main() {
cd "$(dirname "$0")" || exit 1
REPO="$(pwd)"
MIN_NODE=20

fail() {
  echo
  echo "✗ $1"
  echo
  read -n 1 -s -r -p "Press any key to close."
  exit 1
}

# Port comes from the machine settings file (default 4317).
SETTINGS="${MINDSCAPE_SETTINGS_DIR:-$HOME/Library/Application Support/Mindscape}/settings.json"
PORT=4317
if [ -f "$SETTINGS" ]; then
  P=$(/usr/bin/sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$SETTINGS")
  [ -n "$P" ] && PORT="$P"
fi
URL="http://127.0.0.1:$PORT"

healthy() { curl -fsS --max-time 1 "$URL/api/health" 2>/dev/null | grep -q '"app":"mindscape"'; }

close_window() {
  # Best effort: close this Terminal window once this script has exited. The
  # closer runs detached and waits, so Terminal has no running process to ask about.
  node release/cli.mjs close-launcher-window "$(tty)" >/dev/null 2>&1
  exit 0
}

command -v node >/dev/null 2>&1 || fail "Node.js isn't installed or isn't on PATH."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge "$MIN_NODE" ] || fail "Mindscape needs Node $MIN_NODE+; found $(node -v)."

# One-click update. Never blocks starting: any problem just means "start what's here".
if [ -z "$MINDSCAPE_NO_UPDATE" ] && [ -f release/cli.mjs ]; then
  echo "Checking for updates…"
  BEFORE=$(git rev-parse HEAD 2>/dev/null)
  node release/cli.mjs update
  AFTER=$(git rev-parse HEAD 2>/dev/null)
  if [ -n "$BEFORE" ] && [ "$BEFORE" != "$AFTER" ]; then
    if healthy; then
      node release/cli.mjs stop >/dev/null 2>&1
      for _ in 1 2 3 4 5 6 7 8 9 10; do healthy || break; sleep 0.5; done
    fi
    # Run the launcher that just arrived.
    MINDSCAPE_NO_UPDATE=1 exec /bin/bash "$REPO/Mindscape.command"
  fi
fi

if healthy; then
  open "$URL"
  close_window
fi
[ -f "$SETTINGS" ] || fail "This Mac isn't set up yet. In this folder, run:
  ./bin/mindscape setup --vault \"\$HOME/Desktop/Mindscape Vault\""

# Dev Mac only: rebuild the release if the code changed since it was built.
if [ -d node_modules/esbuild ]; then
  CURRENT=$(node scripts/source-hash.mjs)
  if ! grep -q "\"source\": \"$CURRENT\"" release/BUILD.json 2>/dev/null; then
    echo "Code changed — rebuilding release…"
    npm run release --silent >/dev/null 2>"$REPO/.build-error.log" || fail "Build failed. See $REPO/.build-error.log"
    rm -f "$REPO/.build-error.log"
  fi
fi

[ -f release/server.mjs ] && [ -f release/ui/index.html ] || fail "The prebuilt app (release/) is missing. In this folder, run: git pull"

echo "Starting Mindscape…"
# Detached from this window, so closing it never asks to terminate the server.
START_OUTPUT=$(node release/cli.mjs start 2>&1) || fail "$START_OUTPUT"

open "$URL"
close_window
}

main "$@"
exit $?
