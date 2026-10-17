#!/bin/bash
# Phase 0: records the facts about this Mac that the plan depends on.
# Writes workmac-check.md in the repo (git-ignored) and prints it.
# Read-only: changes nothing on the machine.

cd "$(dirname "$0")/.." || exit 1
OUT="workmac-check.md"

yes_no() { if eval "$1" >/dev/null 2>&1; then echo "yes"; else echo "no"; fi; }

desktop_link=$( [ -L "$HOME/Desktop" ] && readlink "$HOME/Desktop" || echo "no (regular folder)" )
icloud_desktop=$(yes_no '[ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Desktop" ]')
icloud_setting=$(defaults read com.apple.finder FXICloudDriveDesktop 2>/dev/null || echo "not set")
onedrive_dirs=$(ls -d "$HOME"/Library/CloudStorage/OneDrive* 2>/dev/null | tr '\n' ' ')
onedrive_desktop="no"
for d in "$HOME"/Library/CloudStorage/OneDrive*; do
  [ -d "$d/Desktop" ] && onedrive_desktop="yes ($d/Desktop exists)"
done
cloud_xattr=$(xattr -l "$HOME/Desktop" 2>/dev/null | grep -iE 'cloud|fileprovider' | head -1)

registry=$(npm config get registry 2>/dev/null || echo "npm not installed")
npm_ping=$(command -v npm >/dev/null && (npm ping --silent >/dev/null 2>&1 && echo "ok" || echo "blocked") || echo "n/a")

{
  echo "# Mindscape work-Mac check — $(date '+%Y-%m-%d %H:%M')"
  echo
  echo "## Machine"
  echo "- macOS: $(sw_vers -productVersion) ($(uname -m))"
  echo "- Node: $(node -v 2>/dev/null || echo 'NOT FOUND')"
  echo "- npm: $(npm -v 2>/dev/null || echo 'NOT FOUND')"
  echo "- git: $(git --version 2>/dev/null || echo 'NOT FOUND')"
  echo "- Claude Code: $(claude --version 2>/dev/null || echo 'not on PATH')"
  echo
  echo "## npm (for reference only — Mindscape runs without it)"
  echo "- Registry: $registry"
  echo "- Registry reachable (npm ping): $npm_ping"
  echo "- Prebuilt release present: $(yes_no '[ -f release/server.mjs ] && [ -f release/ui/index.html ]') (npm install is NOT needed on this Mac)"
  echo
  echo "## Is the Desktop synced? (vault would live at ~/Desktop/Mindscape Vault)"
  echo "- ~/Desktop is a symlink: $desktop_link"
  echo "- iCloud Drive has a Desktop folder: $icloud_desktop"
  echo "- Finder iCloud Desktop setting: $icloud_setting"
  echo "- OneDrive folders: ${onedrive_dirs:-none}"
  echo "- OneDrive has a Desktop folder: $onedrive_desktop"
  echo "- Cloud attributes on ~/Desktop: ${cloud_xattr:-none}"
  echo
  echo "## Manual checks (fill in)"
  echo "- [ ] \`./bin/mindscape setup --vault \"\$HOME/Desktop/Mindscape Vault\"\` succeeded"
  echo "- [ ] Double-clicking Mindscape.command opened the page listing vault files"
  echo "- [ ] Browser used at work: ______"
  echo "- [ ] Shortcut check on the page — ⌘S: __  ⌘K: __  ⌘J: __"
  echo "- [ ] Claude Code can be given access to the vault folder (try: open Claude Code, run \`/add-dir ~/Desktop/Mindscape\\ Vault\`, and ask it to list the folder)"
} > "$OUT"

cat "$OUT"
echo
echo "Saved to $(pwd)/$OUT"
