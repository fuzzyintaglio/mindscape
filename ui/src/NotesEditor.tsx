import { indentLess, indentMore } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { EditorView, keymap, placeholder as placeholderText } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { tags } from '@lezer/highlight';
import { type MutableRefObject, useEffect, useRef } from 'react';

// Markdown source, Obsidian-style: headings bold and a bit larger, the # marks quiet.
// Colors come from the theme variables.
const markdownStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', fontSize: '1.3em' },
  { tag: tags.heading2, fontWeight: '700', fontSize: '1.15em' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--accent)' },
  { tag: tags.monospace, fontFamily: 'var(--mono)', color: 'var(--muted)' },
  { tag: [tags.processingInstruction, tags.punctuation, tags.contentSeparator], color: 'var(--muted)' },
  { tag: tags.quote, color: 'var(--muted)' },
]);

/** Lets the page change the text while you type, without moving your cursor. */
export interface EditorHandle {
  getText(): string;
  /** Replace the whole text; only the part that differs is touched. */
  setText(text: string): void;
  insert(at: number, text: string): void;
  focus(): void;
}

export interface NotesEditorProps {
  initial: string;
  onChange: (text: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
  handleRef?: MutableRefObject<EditorHandle | null>;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

/** The smallest single replacement that turns `from` into `to`. */
export function diffRange(from: string, to: string): { from: number; to: number; insert: string } {
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start++;
  let endFrom = from.length;
  let endTo = to.length;
  while (endFrom > start && endTo > start && from[endFrom - 1] === to[endTo - 1]) {
    endFrom--;
    endTo--;
  }
  return { from: start, to: endFrom, insert: to.slice(start, endTo) };
}

/** Markdown source editor (Obsidian-style source mode). ⌘S saves, Esc cancels. */
export default function NotesEditor({
  initial,
  onChange,
  onSave,
  onCancel,
  handleRef,
  placeholder = 'Write anything — markdown works.',
  autoFocus = true,
  className = '',
}: NotesEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks without recreating the editor.
  const handlers = useRef({ onChange, onSave, onCancel });
  handlers.current = { onChange, onSave, onCancel };

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      doc: initial,
      extensions: [
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => (handlers.current.onSave?.(), true) },
          { key: 'Escape', run: () => (handlers.current.onCancel ? (handlers.current.onCancel(), true) : false) },
          // Tab nests list items (and indents any line) like other editors, instead of leaving the page.
          { key: 'Tab', preventDefault: true, run: indentMore },
          { key: 'Shift-Tab', preventDefault: true, run: indentLess },
        ]),
        // Four spaces nest correctly under both "- " and "1. " items.
        indentUnit.of('    '),
        minimalSetup,
        markdown(),
        syntaxHighlighting(markdownStyle),
        EditorView.lineWrapping,
        placeholderText(placeholder),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
        }),
      ],
    });
    if (handleRef) {
      handleRef.current = {
        getText: () => view.state.doc.toString(),
        setText: (text) => {
          const current = view.state.doc.toString();
          if (text !== current) view.dispatch({ changes: diffRange(current, text) });
        },
        insert: (at, text) => view.dispatch({ changes: { from: Math.min(at, view.state.doc.length), insert: text } }),
        focus: () => view.focus(),
      };
    }
    if (autoFocus) {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    }
    return () => {
      if (handleRef) handleRef.current = null;
      view.destroy();
    };
    // The editor is created once per edit session; `initial` is only the starting text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className={`notes-editor ${className}`} />;
}
