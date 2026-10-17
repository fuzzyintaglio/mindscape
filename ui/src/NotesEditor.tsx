import { markdown } from '@codemirror/lang-markdown';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

interface Props {
  initial: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** Markdown source editor (Obsidian-style source mode). ⌘S saves, Esc cancels. */
export default function NotesEditor({ initial, onChange, onSave, onCancel }: Props) {
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
          { key: 'Mod-s', preventDefault: true, run: () => (handlers.current.onSave(), true) },
          { key: 'Escape', run: () => (handlers.current.onCancel(), true) },
        ]),
        minimalSetup,
        markdown(),
        EditorView.lineWrapping,
        placeholder('Write anything — markdown works.'),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
        }),
      ],
    });
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    return () => view.destroy();
    // The editor is created once per edit session; `initial` is only the starting text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="notes-editor" />;
}
