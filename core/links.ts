// [[Wikilinks]], the Obsidian way: the link target is a file name without ".md",
// matched case-insensitively, optionally followed by #heading or |alias.

/** "[[Name|alias]]" or "Name" → "Name". */
export function refName(ref: string): string {
  const inner = ref.trim().replace(/^\[\[/, '').replace(/\]\]$/, '');
  return inner.split(/[|#]/)[0]!.trim();
}

export function toRef(name: string): string {
  return `[[${name}]]`;
}

export const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Characters that break file names or wikilinks. */
const UNSAFE = /[\\/:*?"<>|#^[\]\n\r\t]/g;

/** Clean a reference-note name for use as a file name; '' if nothing usable is left. */
export function cleanNoteName(name: string): string {
  return name.replace(UNSAFE, '-').replace(/\s+/g, ' ').replace(/^[.\s-]+/, '').trim().slice(0, 120).trim();
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Point every [[old]] / [[old#x]] / [[old|x]] in `text` at `next`. Returns the text unchanged if none. */
export function rewriteLinks(text: string, old: string, next: string): string {
  const pattern = new RegExp(`\\[\\[\\s*${escapeRegex(old)}\\s*(?=[#|\\]])`, 'gi');
  return text.replace(pattern, `[[${next}`);
}

export const DATE_NAME = /^\d{4}-\d{2}-\d{2}$/;
