// CLI commands that read or write the vault directly — the ones the /mindscape
// skill uses. They work whether or not the server is running.
import { existsSync, readFileSync } from 'node:fs';
import { STATUSES, STATUS_LABELS, compareCards } from '../core/cards.ts';
import { ensureDaily, ensureDailyTemplate, formatDay } from '../core/daily.ts';
import { VaultFiles } from '../core/files.ts';
import { DRAFT_PATH, formatPending, preparePending, submitDraft, validateDraft } from '../core/intake.ts';
import { refName } from '../core/links.ts';
import { NoteStore } from '../core/notes.ts';
import { loadConfig } from '../core/config.ts';
import { allEvents, currentWeek, formatPoints, shiftWeek, summarizeWeek } from '../core/points.ts';
import { loadAllPins, pinnedIds, readDay } from '../core/pins.ts';
import { writeReview } from '../core/reviews.ts';
import { loadSettings } from '../core/settings.ts';
import { CardStore } from '../core/store.ts';
import { toLocalDate } from '../core/time.ts';
import { briefing, daysUntouched } from '../core/today.ts';
import { assertVaultOutsideRepo } from '../core/vault.ts';

function openVault() {
  const { vaultPath } = loadSettings();
  assertVaultOutsideRepo(vaultPath);
  if (!existsSync(vaultPath)) throw new Error(`No vault at ${vaultPath} — run: mindscape setup`);
  const files = new VaultFiles(vaultPath);
  const cards = new CardStore(vaultPath, files);
  return { vaultPath, files, cards, notes: new NoteStore(files, cards) };
}

const shortDate = (date: string) => formatDay(date, 'MMM D');

/** Create today's daily note if it doesn't exist yet. */
export function today() {
  const { vaultPath, files } = openVault();
  ensureDailyTemplate(files);
  const date = toLocalDate();
  const { created } = ensureDaily(files, date);
  console.log(`${created ? 'Created' : 'Already there:'} ${vaultPath}/daily/${date}.md`);
}

/** The Today panel, as text. */
export function printBriefing() {
  const { vaultPath, files, cards } = openVault();
  const all = cards.list().cards;
  const week = summarizeWeek(allEvents(cards.pointsCards(), loadConfig(vaultPath), loadAllPins(files)), currentWeek());
  const pinned = pinnedIds(readDay(files)).map((id) => all.find((c) => c.id === id)).filter((c) => !!c);
  const { followUp, stale, due } = briefing(all);
  const lines = [`Today — ${formatDay(toLocalDate(), 'dddd, MMMM D')}`, ''];
  if (pinned.length) {
    lines.push("Today's priorities (pinned):");
    for (const c of pinned) lines.push(`  • ${c.title} — ${STATUS_LABELS[c.status]}`);
    lines.push('');
  }
  if (!followUp.length && !stale.length && !due.length) lines.push('Nothing needs a nudge today.');
  if (due.length) {
    lines.push('Due soon (overdue or due within 7 days):');
    for (const c of due) lines.push(`  • ${c.title} — ${c.due! < toLocalDate() ? 'overdue since' : 'due'} ${shortDate(c.due!)}`);
    if (followUp.length || stale.length) lines.push('');
  }
  if (followUp.length) {
    lines.push('Follow up (blocked, expected date has come):');
    for (const c of followUp) lines.push(`  • ${c.title}${c.blockedBy ? ` — waiting on ${c.blockedBy}` : ''} · expected ${shortDate(c.unblockBy!)}`);
  }
  if (stale.length) {
    if (followUp.length) lines.push('');
    lines.push('Gone quiet (In Progress, untouched 7+ days):');
    for (const c of stale) lines.push(`  • ${c.title} — ${daysUntouched(c)} days`);
  }
  const counts = STATUSES.map((s) => `${all.filter((c) => c.status === s).length} ${STATUS_LABELS[s].toLowerCase()}`);
  lines.push('', `Board: ${counts.join(' · ')}`);
  lines.push(`This week: ${formatPoints(week.points)} pts · ${week.closed} closed`);
  console.log(lines.join('\n'));
}

/** A compact list of cards and notes, so Claude can point proposals at the right ids and names. */
export function printIndex() {
  const { cards, notes } = openVault();
  const lines = ['Cards on the board (id · status · effort · title · due · linked notes):'];
  const list = cards.list().cards;
  for (const status of STATUSES) {
    for (const c of list.filter((x) => x.status === status).sort(compareCards)) {
      lines.push(`${c.id} · ${c.status} · ${c.effort} · ${c.title}${c.due ? ` · due ${c.due}` : ''}${c.refs.length ? ` · ${c.refs.map(refName).join(', ')}` : ''}`);
    }
  }
  if (!list.length) lines.push('(none)');
  lines.push('', 'Reference notes (name · linked cards · first line):');
  const all = notes.list();
  for (const n of all) lines.push(`${n.name} · ${n.linkedCards} · ${n.preview}`);
  if (!all.length) lines.push('(none)');
  console.log(lines.join('\n'));
}

/** Write a weekly review by hand (last week unless one is named). Keeps the Reflection. */
export function review(week = shiftWeek(currentWeek(), -1)) {
  const { vaultPath, files, cards } = openVault();
  const result = writeReview({ vault: vaultPath, files, store: cards, rules: loadConfig(vaultPath) }, week);
  if (!result.ok) throw new Error(result.error);
  console.log(`Wrote ${vaultPath}/${result.path}`);
}

export function intake(args: string[]) {
  const [sub, ...rest] = args;
  const { vaultPath, files, cards, notes } = openVault();
  if (sub === 'pending') {
    console.log(formatPending(preparePending(files, { includeToday: rest.includes('--include-today') }), vaultPath));
    return;
  }
  if (sub === 'validate') {
    const path = rest[0] ?? `${vaultPath}/${DRAFT_PATH}`;
    if (!existsSync(path)) throw new Error(`No file at ${path}`);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      throw new Error(`Not valid JSON: ${(err as Error).message}`);
    }
    const { proposals, errors } = validateDraft(raw, { files, cards: cards.list().cards, noteNames: notes.list().map((n) => n.name) });
    if (errors.length) {
      console.log(errors.join('\n'));
      process.exitCode = 1;
    } else console.log(`OK — ${proposals.length} proposal${proposals.length === 1 ? '' : 's'}.`);
    return;
  }
  if (sub === 'submit') {
    const result = submitDraft(files, cards, notes);
    if (!result.ok) {
      console.log(`Not submitted. Fix these in ${vaultPath}/${DRAFT_PATH} and run submit again:\n${result.errors.join('\n')}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      result.proposals
        ? `Submitted ${result.proposals} proposal${result.proposals === 1 ? '' : 's'} from ${result.notesMarked} daily note${result.notesMarked === 1 ? '' : 's'}. Review them on Mindscape's Intake screen.`
        : `No proposals. Marked ${result.notesMarked} daily note${result.notesMarked === 1 ? '' : 's'} as processed.`,
    );
    return;
  }
  throw new Error('Usage: mindscape intake pending [--include-today] | validate [file] | submit');
}
