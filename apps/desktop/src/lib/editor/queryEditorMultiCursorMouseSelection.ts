import { EditorSelection, type SelectionRange } from "@codemirror/state";
import type { EditorView, MouseSelectionStyle, ViewUpdate } from "@codemirror/view";

export interface QueryEditorMultiCursorMouseSelectionOptions {
  composing?: boolean;
}

/**
 * The selection that remains after dropping the range around `pos`, or null
 * when no range covers the position or it is the only range. Mirrors
 * CodeMirror's own removeRangeAround: the main index follows the removal so
 * the cursor that stays put keeps its role.
 */
function removeRangeAround(selection: EditorSelection, pos: number): EditorSelection | null {
  const main = selection.mainIndex;
  for (let index = 0; index < selection.ranges.length; index++) {
    const range = selection.ranges[index];
    if (range.from <= pos && range.to >= pos) {
      if (selection.ranges.length === 1) return null;
      return EditorSelection.create(
        selection.ranges.slice(0, index).concat(selection.ranges.slice(index + 1)),
        main === index ? Math.max(0, index - 1) : main > index ? main - 1 : main,
      );
    }
  }
  return null;
}

/**
 * Alt+Ctrl (or Alt+Cmd) multi-cursor clicks. The rectangular selection style
 * claims every Alt click, and it only ever adds cursors: it never toggles one
 * off and it ignores the click type, so a re-click on a wrong cursor adds a
 * duplicate instead of cancelling it and a double click plants an empty
 * cursor instead of selecting the word. This style runs ahead of the
 * rectangular one and owns exactly those two gestures:
 *
 * - single click on an existing cursor removes that cursor;
 * - double click adds the word under the pointer to the multi-cursor set.
 *
 * Everything else falls through: plain Alt still draws a rectangle, plain
 * Ctrl still navigates to the object under the pointer, and clicks that add
 * a cursor keep the rectangular style's behaviour.
 */
export function createQueryEditorMultiCursorMouseSelection(view: EditorView, event: MouseEvent, options: QueryEditorMultiCursorMouseSelectionOptions = {}): MouseSelectionStyle | null {
  if (event.button !== 0 || (event.detail !== 1 && event.detail !== 2) || !event.altKey || !(event.ctrlKey || event.metaKey) || options.composing) return null;
  const start = view.posAndSideAtCoords({ x: event.clientX, y: event.clientY }, false);
  if (!start) return null;
  const startSelection = view.state.selection;

  if (event.detail === 1) {
    const toggled = removeRangeAround(startSelection, start.pos);
    if (!toggled) return null;
    let selection = toggled;
    return {
      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        selection = selection.map(update.changes);
      },
      get() {
        return selection;
      },
    };
  }

  // Double click: the word the pointer hit, the same word CodeMirror's
  // default double click would select. `assoc` picks the side the pointer
  // actually hit, so a click on the space before a word selects nothing and
  // falls through to the rectangular style.
  const hit = start.assoc < 0 ? start.pos - 1 : start.pos;
  const word = hit < 0 ? null : view.state.wordAt(hit);
  if (!word) return null;

  let range: SelectionRange = word;
  let base = startSelection;
  return {
    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      range = range.map(update.changes);
      base = base.map(update.changes);
    },
    get(_currentEvent, extend, multiple) {
      // Shift is held for the multi-cursor gesture, so with several cursors
      // a double click must add the word, never extend the main range.
      if (multiple) return base.addRange(range);
      if (extend) return base.replaceRange(base.main.extend(range.from, range.to));
      return EditorSelection.create([range]);
    },
  };
}
