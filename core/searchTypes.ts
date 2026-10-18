// Search result shapes. No file access, so the UI can import them too.
import type { Status } from './cards.ts';

export const SEARCH_KINDS = ['card', 'reference', 'daily', 'review'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export interface SearchHit {
  kind: SearchKind;
  key: string;
  title: string;
  path: string;
  snippet: string;
  /** The indexed words that matched, for highlighting. */
  terms: string[];
  /** False for typo-tolerant matches, which come after the exact ones. */
  exact: boolean;
  status?: Status;
  archived?: boolean;
}
