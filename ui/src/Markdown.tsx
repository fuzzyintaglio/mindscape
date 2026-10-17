import MarkdownIt from 'markdown-it';

// html: false means raw HTML in notes is shown as text, never run — notes can't inject anything.
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet('target', '_blank');
  tokens[idx]!.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** [[Wikilinks]] render as styled text for now; Phase 2 makes them clickable. */
function wikilinks(html: string): string {
  return html.replace(/\[\[([^\]\n]+)\]\]/g, (_m, name: string) => `<span class="wikilink">${name}</span>`);
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={`markdown ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: wikilinks(md.render(text)) }} />;
}
