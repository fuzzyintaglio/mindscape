---
name: mindscape
description: Start the day in Mindscape — create today's daily note, show the Today briefing, and turn new lines in past daily notes into proposals (new cards, card log entries, reference notes) for the user to review in the app. Use when the user runs /mindscape or asks to process their daily notes.
argument-hint: "[include today]"
allowed-tools:
  - Bash({{CLI}}:*)
  - Read(/{{VAULT}}/**)
  - Write(/{{VAULT}}/intake/draft.json)
  - Edit(/{{VAULT}}/intake/draft.json)
---
<!-- mindscape-skill: installed by `mindscape setup` from the Mindscape repo. Re-running setup replaces this file. -->

# /mindscape

You keep the user's Mindscape board and reference notes up to date from their daily notes. **You propose; the app applies.** The user reviews every proposal on Mindscape's Intake screen and accepts, edits, or rejects it.

## Rules

- The **only** file you write is `{{VAULT}}/intake/draft.json`. Never edit cards, reference notes, daily notes, or anything else in the vault, not even to fix a typo.
- Exact answers (dates, ids, what's new) come from the Mindscape CLI: `{{CLI}}`. Don't run other commands.
- Don't invent facts. Proposals summarize what the daily note says.

## Steps

1. Run `{{CLI}} today` (creates today's daily note if it doesn't exist yet).
2. Run `{{CLI}} briefing` and show its output to the user as it is.
3. Run `{{CLI}} intake pending`. If the user's arguments ask to include today (arguments: "$ARGUMENTS"), run `{{CLI}} intake pending --include-today` instead.
   - If it prints `Nothing new to process.`, tell the user their notes are all caught up and stop.
   - It lists only lines you haven't seen before, grouped by day and heading. Earlier runs' lines never come back.
4. Run `{{CLI}} index` for the cards on the board (with ids) and the reference notes.
5. Decide what to propose (below). If you need more context, read the full daily note (its path is in the pending output) or a reference note at `{{VAULT}}/reference/<Name>.md`.
6. Write `{{VAULT}}/intake/draft.json` (format below). `{"proposals": []}` is right when nothing is actionable; submitting it still marks the lines as processed.
7. Run `{{CLI}} intake submit`. If it lists problems, fix the draft and run submit again until it succeeds.
8. Tell the user briefly what you proposed (counts by kind, one line each for the notable ones) and that they can review it on Mindscape's **Intake** screen.

## What to propose

There are four kinds. One line can lead to more than one proposal (e.g. a card log entry and an addition to a note).

- **`new-task`**: something the user needs to do that isn't already a card. Title: short and starting with a verb ("Send the revised deck to finance"). `effort`: `low` (under an hour), `medium` (a few hours to a day), `high` (several days, or many steps). `refs`: names of existing reference notes it relates to, or of notes you propose in the same draft.
- **`card-log`**: progress, a decision, a date, or a fact about an **existing** card. `cardId` is the id from `index`. `text`: one concise sentence.
- **`new-note`**: a topic (project, person, vendor, system) with real substance that has no reference note yet. `text`: markdown bullets with the facts from the note. `linkCards`: ids of cards it belongs with (optional).
- **`note-append`**: new facts for an existing reference note. `note` is its exact name from `index`.

Skip small talk, things that are only reminders of what's already a card, and anything you'd have to guess at. Prefer `card-log` over `new-task` when a line is about work that already has a card. Fewer, better proposals beat many weak ones.

`source.quote` must be copied **word for word** from one line of the daily note (leaving out the leading `- ` or a timestamp is fine). Submit checks it.

## Draft format

```json
{
  "proposals": [
    {
      "type": "new-task",
      "source": { "date": "2026-10-17", "quote": "09:41 need to send the revised deck to finance" },
      "title": "Send the revised deck to finance",
      "effort": "low",
      "refs": ["Q4 Budget"],
      "why": "Action item with no card yet"
    },
    {
      "type": "card-log",
      "source": { "date": "2026-10-17", "quote": "legal says the review adds two weeks" },
      "cardId": "01JAB3EXAMPLE0000000000000",
      "text": "Legal review adds about two weeks."
    },
    {
      "type": "new-note",
      "source": { "date": "2026-10-17", "quote": "Atlas kickoff: owners are design and legal, launch in March" },
      "name": "Atlas",
      "text": "- Owners: design and legal\n- Launch: March",
      "linkCards": []
    },
    {
      "type": "note-append",
      "source": { "date": "2026-10-17", "quote": "budget freeze moved to Nov 15" },
      "note": "Q4 Budget",
      "text": "- Budget freeze moved to Nov 15."
    }
  ]
}
```

`why` is optional: a few words shown to the user to explain the proposal. The full schema is `{{REPO}}/schemas/intake-draft.schema.json`.
