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

**Just double-click `Mindscape.command`.** Each time, it checks GitHub and fast-forwards to the latest version (a `git pull`), restarts Mindscape if it was already running, and refreshes the `/mindscape` skill if it changed. The page says "Mindscape was updated" once afterward.

It skips the update, and starts the version you have, when GitHub can't be reached, when a file in this folder was changed by hand (`git status` shows which), or when this copy has its own commits. `./bin/mindscape update` does the same check by hand.

## Keyboard

Press **`?`** in Mindscape for the full list. The main ones:
- **⌘K** or **`/`**: search.
- **⌘J**: capture.
- **`n`**: new card.
- **`g`** then **`b`/`d`/`n`/`i`/`a`/`r`/`s`**: go to Board, Today, Notes, Intake, Archive, Reviews, or Settings.
- On the board (arrow-key selection is rough, and fixing it is parked for now):
  - **arrows**: select a card
  - **Enter**: open it
  - **1–4**: move it
  - **`e`**: change effort
  - **⌫**: delete it
- **⌘Z**: undo, while an Undo button is showing.
- **Esc**: leave the daily-note editor, so the single-key shortcuts work again.
- **← →**: change day, or change week on a review page.

## Backup

**Settings (⚙) → Data → Export vault as .zip** downloads the whole vault in a folder, ready to unzip anywhere. It leaves out the vault's git history and the capture token.

**Obsidian check** (the backup plan if Mindscape ever breaks):
1. In Obsidian, choose **Open folder as vault** and pick your vault (or an unzipped export).
2. Check these:
   - Cards are in `tasks/`, with their frontmatter showing as Properties.
   - `[[Note]]` and `[[2026-10-17]]` links open the right notes.
   - Reference notes show backlinks from the cards that link to them.

Obsidian adds a `.obsidian/` folder. Mindscape ignores it, and its changing window-layout files are kept out of the vault's history.

## Commands (work Mac)

| Command | What it does |
|---|---|
| `./bin/mindscape setup --vault <path>` | Save this Mac's vault location and create the vault folders |
| `./bin/mindscape doctor` | Check Node, the release, settings, vault, and whether the server is running |
| `./bin/mindscape start` | Start the background server without opening the browser |
| `./bin/mindscape stop` | Stop the background server |
| `./bin/mindscape "call about timelines"` | Capture a line into today's daily note (`t: …` makes a card instead; `t! …` High effort, `t- …` Low; end with `@fri`, `@tomorrow`, or `@10/30` for a due date) |
| `./bin/mindscape token` | Print the capture token (for calling `/api/capture` from other tools) |
| `./bin/mindscape update` | Get the latest version from GitHub (the launcher does this every time) |
| `./bin/mindscape review [2026-W42]` | Write (or rewrite) a weekly review, last week by default. Your Reflection is kept |
| `./bin/mindscape install-skill` | Reinstall the `/mindscape` skill (after an update changes it) |
| `./bin/mindscape briefing` / `index` / `today` | What `/mindscape` uses: the Today briefing, the card and note list, today's note |
| `./bin/mindscape intake pending` / `submit` | What `/mindscape` uses to read new lines and hand in its proposals |
| `bash scripts/workmac-check.sh` | Record the work-Mac facts the plan depends on (Phase 0) |

## Capture from outside the app

`./bin/mindscape "call about timelines"` captures from Terminal, whether or not Mindscape is running. The endpoint behind it is `POST http://127.0.0.1:4317/api/capture` with `Authorization: Bearer <token>`, where `./bin/mindscape token` prints the token. A global-hotkey macOS Shortcut is parked for now.

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
| Weekly reviews | `<vault>/reviews/2026-W42.md`, written the first time Mindscape runs after each week ends |
| Completed cards | `<vault>/archive/<year>/`, 7 days after completion (the **Archive** tab lists them) |

## Phase 0 on the work Mac

1. Install as above — no `npm install`.
2. Run `bash scripts/workmac-check.sh`. It writes `workmac-check.md` (git-ignored).
3. Double-click `Mindscape.command`, then use the **Shortcut check** panel on the page.
4. Fill in the manual checks at the bottom of `workmac-check.md` and bring the file back to Claude.
