import MarkdownIt from 'markdown-it';
import { DATE_NAME, refName } from '../../core/links.ts';
import { hrefFor } from './route.ts';

// html: false means raw HTML in notes is shown as text, never run — notes can't inject anything.
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet('target', '_blank');
  tokens[idx]!.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// [[Name]], [[Name|label]], [[2026-10-17]] — a dated name opens that daily note, anything else a reference note.
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  if (!state.src.startsWith('[[', state.pos)) return false;
  const end = state.src.indexOf(']]', state.pos + 2);
  if (end < 0) return false;
  const inner = state.src.slice(state.pos + 2, end);
  if (!inner.trim() || inner.includes('\n') || inner.includes('[')) return false;
  if (!silent) {
    const token = state.push('wikilink', '', 0);
    token.content = inner;
  }
  state.pos = end + 2;
  return true;
});

md.renderer.rules.wikilink = (tokens, idx) => {
  const inner = tokens[idx]!.content;
  const name = refName(inner);
  const label = inner.includes('|') ? inner.slice(inner.indexOf('|') + 1).trim() : inner.trim();
  const href = DATE_NAME.test(name) ? hrefFor.daily(name) : hrefFor.note(name);
  return `<a class="wikilink" href="${md.utils.escapeHtml(href)}">${md.utils.escapeHtml(label)}</a>`;
};

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={`markdown ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: md.render(text) }} />;
}
