// Intake proposal shapes. No file access, so the UI can import them too.
// The JSON schema Claude follows is schemas/intake-draft.schema.json.
import type { Effort } from './cards.ts';

export const PROPOSAL_TYPES = ['new-task', 'card-log', 'new-note', 'note-append'] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export const PROPOSAL_LABELS: Record<ProposalType, string> = {
  'new-task': 'New tasks',
  'card-log': 'Add to card log',
  'new-note': 'New reference notes',
  'note-append': 'Add to reference notes',
};

/** Where a proposal came from: a daily note, and the line quoted from it word for word. */
export interface ProposalSource {
  date: string;
  quote: string;
}

export type ProposalFields =
  | { type: 'new-task'; title: string; effort: Effort; refs: string[] }
  | { type: 'card-log'; cardId: string; text: string }
  | { type: 'new-note'; name: string; text: string; linkCards: string[] }
  | { type: 'note-append'; note: string; text: string };

export type Proposal = ProposalFields & { source: ProposalSource; why?: string };

export type ProposalStatus = 'pending' | 'accepted' | 'rejected';

export type StoredProposal = Proposal & {
  id: string;
  status: ProposalStatus;
  decided?: string;
  /** What accepting it made, e.g. the new card's id. */
  result?: string;
};

/** A pending proposal as the review screen sees it. */
export interface ReviewItem {
  runId: string;
  proposal: StoredProposal;
  /** Why it can't be accepted as it is (e.g. its card was deleted). Fix it with Edit. */
  stale?: string;
  /** Worth knowing but not blocking, e.g. a link to a note that doesn't exist yet. */
  warning?: string;
  /** For card-log proposals: the target card's current title. */
  cardTitle?: string;
}

/** What the reviewer may change before accepting. */
export type ProposalEdits = Partial<{
  title: string;
  effort: Effort;
  refs: string[];
  cardId: string;
  text: string;
  name: string;
  note: string;
  linkCards: string[];
}>;
