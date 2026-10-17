#!/bin/bash
# Double-click to open Mindscape.
#  - Already running → just opens the browser.
#  - Otherwise: checks Node, starts the prebuilt server (release/) in the
#    background, opens the browser, and closes this window.
#  - On the dev Mac only (where node_modules exists), it first rebuilds
#    release/ if the code changed. The work Mac never builds or installs.

cd "$(dirname "$0")" || exit 1
REPO="$(pwd)"
LOG_DIR="$HOME/Library/Logs/Mindscape"
LOG="$LOG_DIR/server.log"
MIN_NODE=20

fail() {
  echo
  echo "✗ $1"
  echo
  read -n 1 -s -r -p "Press any key to close."
  exit 1
}

# Port comes from the machine settings file (default 4317).
SETTINGS="$HOME/Library/Application Support/Mindscape/settings.json"
PORT=4317
if [ -f "$SETTINGS" ]; then
  P=$(/usr/bin/sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$SETTINGS")
  [ -n "$P" ] && PORT="$P"
fi
URL="http://127.0.0.1:$PORT"

healthy() { curl -fsS --max-time 1 "$URL/api/health" 2>/dev/null | grep -q '"app":"mindscape"'; }

close_window() {
  # Best effort: close this Terminal window. Harmless if it doesn't work.
  osascript -e 'tell application "Terminal" to close (every window whose name contains "Mindscape.command")' >/dev/null 2>&1 &
  exit 0
}

if healthy; then
  open "$URL"
  close_window
fi

command -v node >/dev/null 2>&1 || fail "Node.js isn't installed or isn't on PATH."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge "$MIN_NODE" ] || fail "Mindscape needs Node $MIN_NODE+; found $(node -v)."
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

mkdir -p "$LOG_DIR"
echo "Starting Mindscape…"
nohup node release/server.mjs >>"$LOG" 2>&1 &
disown

for _ in $(seq 1 40); do
  healthy && break
  sleep 0.25
done
healthy || fail "Mindscape didn't start. Last lines of $LOG:
$(tail -n 15 "$LOG")"

open "$URL"
close_window
