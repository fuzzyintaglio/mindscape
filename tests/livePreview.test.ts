// @vitest-environment jsdom
// The daily note's live preview: which markdown markers are hidden, and where.
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { previewDecorations } from '../ui/src/livePreview.ts';

const DOC = '## Capture\n- 09:41 call **vendor** about [[Project Alpha]]\n- [x] send the deck\n- [ ] book the room\n';

function decorations(doc: string, cursor?: number) {
  let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  if (cursor !== undefined) state = state.update({ selection: { anchor: cursor } }).state;
  ensureSyntaxTree(state, state.doc.length, 5000);
  const out: { from: number; to: number; text: string; kind: string }[] = [];
  previewDecorations(state, cursor !== undefined).between(0, doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: string; widget?: { constructor: { name: string } }; attributes?: Record<string, string> };
    const kind = spec.widget ? spec.widget.constructor.name : spec.class ?? (from === to ? 'line' : 'hide');
    out.push({ from, to, text: doc.slice(from, to), kind });
  });
  return out;
}

describe('live preview', () => {
  it('hides markers, draws bullets and checkboxes, and marks links and timestamps', () => {
    const d = decorations(DOC);
    const hidden = d.filter((x) => x.kind === 'hide').map((x) => x.text);
    expect(hidden).toEqual(['## ', '**', '**', '[[', ']]', '- ', '- ']);
    expect(d.find((x) => x.kind === 'cm-heading-line cm-h2')).toBeTruthy();
    expect(d.filter((x) => x.kind === 'BulletWidget')).toHaveLength(1);
    expect(d.filter((x) => x.kind === 'CheckboxWidget').map((x) => x.text)).toEqual(['[x] ', '[ ] ']);
    expect(d.find((x) => x.kind === 'cm-wikilink')!.text).toBe('Project Alpha');
    expect(d.find((x) => x.kind === 'cm-ts')!.text).toBe('09:41');
    expect(d.find((x) => x.kind === 'cm-task-done')!.text).toBe('send the deck');
  });

  it('shows the raw markdown on the line with the cursor, and keeps its heading style', () => {
    const lineTwo = DOC.indexOf('call');
    const d = decorations(DOC, lineTwo);
    const onLineTwo = d.filter((x) => x.from >= DOC.indexOf('- 09:41') && x.to <= DOC.indexOf('\n- [x]'));
    expect(onLineTwo).toEqual([]);
    expect(d.filter((x) => x.kind === 'hide').map((x) => x.text)).toEqual(['## ', '- ', '- ']);

    const onHeading = decorations(DOC, 3);
    expect(onHeading.find((x) => x.text === '## ')).toBeUndefined();
    expect(onHeading.find((x) => x.kind === 'cm-heading-line cm-h2')).toBeTruthy();
  });

  it('shows a link alias and hides the target, and leaves numbered lists alone', () => {
    const doc = 'See [[Project Alpha|the project]] and [docs](https://example.com)\n1. first\n';
    const d = decorations(doc);
    expect(d.find((x) => x.kind === 'cm-wikilink')!.text).toBe('the project');
    expect(d.filter((x) => x.kind === 'hide').map((x) => x.text)).toEqual(['[[Project Alpha|', ']]', '[', '](https://example.com)']);
    expect(d.find((x) => x.kind === 'cm-link-text')!.text).toBe('docs');
    expect(d.find((x) => x.text === '1.')).toBeUndefined();
  });
});
