#!/bin/bash
# Double-click to open Mindscape.
#  - Already running → just opens the browser.
#  - Otherwise: checks Node, rebuilds the UI if the code changed, starts the
#    server in the background, opens the browser, and closes this window.

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
[ -d node_modules ] || fail "Dependencies aren't installed. In this folder, run: npm install"
[ -f "$SETTINGS" ] || fail "This Mac isn't set up yet. In this folder, run: npm run setup -- --vault \"\$HOME/Desktop/Mindscape Vault\""

# Rebuild when the UI is missing or any UI source/config is newer than the last build.
STAMP="dist/ui/index.html"
if [ ! -f "$STAMP" ] || [ -n "$(find ui vite.config.ts package.json -newer "$STAMP" -type f -not -path 'ui/dist/*' 2>/dev/null | head -1)" ]; then
  echo "Building Mindscape…"
  npm run build --silent >/dev/null 2>"$REPO/.build-error.log" || fail "Build failed. See $REPO/.build-error.log"
  rm -f "$REPO/.build-error.log"
fi

mkdir -p "$LOG_DIR"
echo "Starting Mindscape…"
nohup "$REPO/node_modules/.bin/tsx" server/index.ts >>"$LOG" 2>&1 &
disown

for _ in $(seq 1 40); do
  healthy && break
  sleep 0.25
done
healthy || fail "Mindscape didn't start. Last lines of $LOG:
$(tail -n 15 "$LOG")"

open "$URL"
close_window
