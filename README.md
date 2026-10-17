# Mindscape

A local-only productivity tool: a kanban board, daily notes, and reference notes, with Claude-assisted intake. Everything runs on your Mac and your data is plain markdown files.

The full plan lives in a separate planning note, not in this repo.

> **This repo holds code only.** Your vault (tasks and notes) lives in a separate folder and must never be committed. The app refuses to start if the vault is inside this folder.

## How it's shipped

The repo includes a **prebuilt app in `release/`**: the server, the CLI, and the UI with all their dependencies bundled into plain JavaScript. Running Mindscape only needs **Node 20+**. There is **no `npm install`** on the machine where you use it.

Development (editing code, running tests, building `release/`) happens on the dev Mac, which does need `npm install`.

## Install (work Mac — Node only)

```bash
git clone https://github.com/fuzzyintaglio/mindscape.git
cd mindscape
./bin/mindscape setup --vault "$HOME/Desktop/Mindscape Vault"
```

Then double-click **`Mindscape.command`**. It opens Mindscape in your browser at http://127.0.0.1:4317.

## Update (work Mac)

```bash
cd mindscape && ./bin/mindscape stop; git pull
```

Then double-click `Mindscape.command` again.

## Commands (work Mac)

| Command | What it does |
|---|---|
| `./bin/mindscape setup --vault <path>` | Save this Mac's vault location and create the vault folders |
| `./bin/mindscape doctor` | Check Node, the release, settings, vault, and whether the server is running |
| `./bin/mindscape stop` | Stop the background server |
| `bash scripts/workmac-check.sh` | Record the work-Mac facts the plan depends on (Phase 0) |

## Development (dev Mac)

```bash
npm install
npm run dev        # live reload at http://127.0.0.1:5317
npm test
npm run release    # rebuild release/ — commit it with your code changes
```

`Mindscape.command` on the dev Mac rebuilds `release/` automatically when the code changed. A test fails if `release/` is out of date, so a stale build can't be committed unnoticed.

## Where things live

| What | Where |
|---|---|
| Code + prebuilt app | this folder (`release/` is the prebuilt app) |
| Vault (your data) | wherever `setup` pointed, e.g. `~/Desktop/Mindscape Vault` |
| Machine settings | `~/Library/Application Support/Mindscape/settings.json` |
| Server log | `~/Library/Logs/Mindscape/server.log` |

## Phase 0 on the work Mac

1. Install as above — no `npm install`.
2. Run `bash scripts/workmac-check.sh`. It writes `workmac-check.md` (git-ignored).
3. Double-click `Mindscape.command`, then use the **Shortcut check** panel on the page.
4. Fill in the manual checks at the bottom of `workmac-check.md` and bring the file back to Claude.
