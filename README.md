# Mindscape

A local-only productivity tool: a kanban board, daily notes, and reference notes, with Claude-assisted intake. Everything runs on your Mac and your data is plain markdown files.

The full plan lives in a separate planning note, not in this repo.

> **This repo holds code only.** Your vault (tasks and notes) lives in a separate folder and must never be committed. The app refuses to start if the vault is inside this folder.

## Install (any Mac)

```bash
git clone https://github.com/fuzzyintaglio/mindscape.git
cd mindscape
npm install
npm run setup -- --vault "$HOME/Desktop/Mindscape Vault"
```

Then double-click **`Mindscape.command`**. It opens Mindscape in your browser at http://127.0.0.1:4317.

## Update

```bash
cd mindscape && git pull && npm install
```

Then double-click `Mindscape.command` again. It rebuilds automatically when the code changed. If Mindscape was already running, stop it first with `npm run stop`.

## Commands

| Command | What it does |
|---|---|
| `npm run setup -- --vault <path>` | Save this Mac's vault location and create the vault folders |
| `npm run doctor` | Check Node, settings, vault, and whether the server is running |
| `npm run stop` | Stop the background server |
| `npm run check:workmac` | Record the work-Mac facts the plan depends on (Phase 0) |
| `npm run dev` | Development mode with live reload at http://127.0.0.1:5317 |
| `npm test` | Run the tests |

## Where things live

| What | Where |
|---|---|
| Code | this folder |
| Vault (your data) | wherever `setup` pointed, e.g. `~/Desktop/Mindscape Vault` |
| Machine settings | `~/Library/Application Support/Mindscape/settings.json` |
| Server log | `~/Library/Logs/Mindscape/server.log` |

## Phase 0 on the work Mac

1. Install as above. If `npm install` fails, copy the error — that's the main thing Phase 0 is checking.
2. Run `npm run check:workmac`. It writes `workmac-check.md` (git-ignored).
3. Double-click `Mindscape.command`, then use the **Shortcut check** panel on the page.
4. Fill in the manual checks at the bottom of `workmac-check.md` and bring the file back to Claude.
