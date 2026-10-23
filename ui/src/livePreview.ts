// Obsidian-style live preview for CodeMirror: markdown shows formatted, and the
// line you're editing shows its raw markers. Only decorations — the text on disk
// is exactly what you typed.
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { refName } from '../../core/links.ts';

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-bullet';
    el.textContent = '•';
    return el;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.className = 'cm-task-check';
    el.checked = this.checked;
    el.setAttribute('aria-label', this.checked ? 'Done' : 'Not done');
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const hide = Decoration.replace({});
const HEADING_LINE = [1, 2, 3, 4, 5, 6].map((n) => Decoration.line({ class: `cm-heading-line cm-h${n}` }));
const linkText = Decoration.mark({ class: 'cm-link-text' });
const timestamp = Decoration.mark({ class: 'cm-ts' });
const doneTask = Decoration.mark({ class: 'cm-task-done' });

/** Line numbers that show raw markdown: those touched by the selection, while the editor has focus. */
function activeLines(state: EditorState, focused: boolean): Set<number> {
  const lines = new Set<number>();
  if (!focused) return lines;
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** The decorations for a document. Exported so tests can check them without a browser. */
export function previewDecorations(
  state: EditorState,
  focused: boolean,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
): DecorationSet {
  const active = activeLines(state, focused);
  const raw = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const out: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          out.push(HEADING_LINE[Number(heading[1]) - 1]!.range(state.doc.lineAt(node.from).from));
          return;
        }
        if (raw(node.from)) return;
        if (name === 'HeaderMark') {
          // "## " → hide the marks and the space after them.
          const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
          if (node.node.parent?.name.startsWith('ATXHeading')) out.push(hide.range(node.from, end));
        } else if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          out.push(hide.range(node.from, node.to));
        } else if (name === 'CodeMark' && node.node.parent?.name === 'InlineCode') {
          out.push(hide.range(node.from, node.to));
        } else if (name === 'ListMark') {
          const item = node.node.parent;
          const isTask = !!item?.getChild('Task');
          const mark = state.doc.sliceString(node.from, node.to);
          const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
          if (isTask) out.push(hide.range(node.from, end));
          else if (/^[-*+]$/.test(mark)) out.push(bullet.range(node.from, node.to));
        } else if (name === 'TaskMarker') {
          const checked = /x/i.test(state.doc.sliceString(node.from, node.to));
          const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, end));
          if (checked) {
            const line = state.doc.lineAt(node.from);
            if (end < line.to) out.push(doneTask.range(end, line.to));
          }
        } else if (name === 'Link') {
          // [text](url): show only the text, styled as a link. (The grammar also reads the
          // inside of a [[wikilink]] as a link with no URL; those are handled below.)
          const marks = node.node.getChildren('LinkMark');
          if (marks.length >= 2 && node.node.getChild('URL')) {
            const open = marks[0]!;
            const close = marks[1]!;
            out.push(hide.range(open.from, open.to));
            if (close.from > open.to) out.push(linkText.range(open.to, close.from));
            out.push(hide.range(close.from, node.to));
          }
          return false;
        }
        return undefined;
      },
    });

    // Things the markdown grammar doesn't know: [[wikilinks]] and capture timestamps.
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      if (!active.has(line.number)) {
        for (const m of line.text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
          const start = line.from + m.index!;
          const inner = m[1]!;
          const alias = inner.indexOf('|');
          const shownFrom = start + 2 + (alias >= 0 ? alias + 1 : 0);
          out.push(hide.range(start, shownFrom));
          out.push(Decoration.mark({ class: 'cm-wikilink', attributes: { 'data-note': refName(inner), title: '⌘-click to open' } }).range(shownFrom, start + 2 + inner.length));
          out.push(hide.range(start + 2 + inner.length, start + m[0].length));
        }
        const ts = /^(\s*[-*+] )(\d{1,2}:\d{2})(?=\s)/.exec(line.text);
        if (ts) out.push(timestamp.range(line.from + ts[1]!.length, line.from + ts[1]!.length + ts[2]!.length));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

/** The extension: decorations for the visible part, the toggleable checkboxes, ⌘-click on links. */
export function livePreview(onOpenNote?: (name: string) => void) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = previewDecorations(view.state, view.hasFocus, view.visibleRanges);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = previewDecorations(u.state, u.view.hasFocus, u.view.visibleRanges);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  const events = EditorView.domEventHandlers({
    mousedown(e, view) {
      const target = e.target as HTMLElement;
      if (target.classList.contains('cm-task-check')) {
        e.preventDefault();
        const pos = view.posAtDOM(target);
        const box = view.state.doc.sliceString(pos, pos + 3);
        if (/^\[[ xX]\]$/.test(box)) view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: box[1] === ' ' ? 'x' : ' ' } });
        return true;
      }
      const link = target.closest<HTMLElement>('.cm-wikilink');
      if (link && (e.metaKey || e.ctrlKey) && onOpenNote) {
        e.preventDefault();
        onOpenNote(link.dataset.note!);
        return true;
      }
      return false;
    },
  });
  return [plugin, events];
}
