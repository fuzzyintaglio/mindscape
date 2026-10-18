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

`setup` also installs the **`/mindscape` skill** for Claude Code (in `~/.claude/skills/mindscape/`). Run `/mindscape` in any Claude Code session, usually first thing in the day. It creates today's note, shows the Today briefing, and turns new lines in your past daily notes into proposals that you accept, edit, or reject on Mindscape's **Intake** screen. Claude only proposes; it never edits your cards or notes. `/mindscape include today` processes today's note too.

## Update (work Mac)

```bash
cd mindscape && ./bin/mindscape stop; git pull
```

Then double-click `Mindscape.command` again. If `./bin/mindscape doctor` says the skill is out of date, run `./bin/mindscape install-skill`.

## Commands (work Mac)

| Command | What it does |
|---|---|
| `./bin/mindscape setup --vault <path>` | Save this Mac's vault location and create the vault folders |
| `./bin/mindscape doctor` | Check Node, the release, settings, vault, and whether the server is running |
| `./bin/mindscape start` | Start the background server without opening the browser |
| `./bin/mindscape stop` | Stop the background server |
| `./bin/mindscape "call about timelines"` | Capture a line into today's daily note (`t: …` makes a card instead) |
| `./bin/mindscape token` | Print the capture token, for the macOS Shortcut below |
| `./bin/mindscape install-skill` | Reinstall the `/mindscape` skill (after an update changes it) |
| `./bin/mindscape briefing` / `index` / `today` | What `/mindscape` uses: the Today briefing, the card and note list, today's note |
| `./bin/mindscape intake pending` / `submit` | What `/mindscape` uses to read new lines and hand in its proposals |
| `bash scripts/workmac-check.sh` | Record the work-Mac facts the plan depends on (Phase 0) |

## Capture from anywhere (macOS Shortcut)

Mindscape accepts captures at `POST http://127.0.0.1:4317/api/capture` with the capture token. To capture from any app with a keyboard shortcut:

1. Run `./bin/mindscape token` and copy the token.
2. In the **Shortcuts** app, make a new shortcut:
   - **Ask for Input** (Text), prompt "Capture".
   - **Get Contents of URL**: URL `http://127.0.0.1:4317/api/capture`, Method **POST**, Headers `Authorization` = `Bearer <your token>`, Request Body **JSON** with a `text` field set to *Provided Input*.
3. In the shortcut's details, **Add Keyboard Shortcut**.

Mindscape has to be running for this; the terminal command works either way.

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
