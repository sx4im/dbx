import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, rectangularSelection } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { createQueryEditorMultiCursorMouseSelection } from "@/lib/editor/queryEditorMultiCursorMouseSelection";
import { createQueryEditorParenthesisMouseSelection } from "@/lib/editor/queryEditorParenthesisMouseSelection";
import { startsQueryEditorRectangularSelection } from "@/lib/editor/queryEditorPointerSelection";
import { createQueryEditorStringMouseSelection } from "@/lib/editor/queryEditorStringMouseSelection";

function eventAt(position: number, assoc: -1 | 1 = 1, overrides: Partial<MouseEvent> = {}): MouseEvent {
  return { altKey: true, button: 0, clientX: position, clientY: assoc, ctrlKey: true, detail: 1, metaKey: false, ...overrides } as MouseEvent;
}

function fakeView(state: EditorState): EditorView {
  return {
    state,
    posAndSideAtCoords(coords: { x: number; y: number }) {
      return { pos: coords.x, assoc: coords.y < 0 ? -1 : 1 };
    },
  } as unknown as EditorView;
}

// EditorState.create drops every range but the main one unless multiple
// selections are allowed, exactly like the real editor enables them.
function multiCursorState(doc: string, selection: EditorSelection): EditorState {
  return EditorState.create({ doc, selection, extensions: [EditorState.allowMultipleSelections.of(true)] });
}

describe("createQueryEditorMultiCursorMouseSelection", () => {
  const doc = "select alpha, beta from t";
  const alpha = doc.indexOf("alpha");
  const beta = doc.indexOf("beta");

  it("removes the cursor under a re-click when other cursors remain", () => {
    const state = multiCursorState(doc, EditorSelection.create([EditorSelection.cursor(alpha), EditorSelection.cursor(beta)], 1));
    const style = createQueryEditorMultiCursorMouseSelection(fakeView(state), eventAt(beta));
    expect(style).not.toBeNull();
    const selection = style!.get(eventAt(beta), false, true);
    expect(selection.ranges).toEqual([EditorSelection.cursor(alpha)]);
    expect(selection.main.from).toBe(alpha);
  });

  it("keeps the main cursor when the removed cursor is not the main one", () => {
    const state = multiCursorState(doc, EditorSelection.create([EditorSelection.cursor(alpha), EditorSelection.cursor(beta)], 0));
    const style = createQueryEditorMultiCursorMouseSelection(fakeView(state), eventAt(beta));
    expect(style).not.toBeNull();
    const selection = style!.get(eventAt(beta), false, true);
    expect(selection.ranges).toEqual([EditorSelection.cursor(alpha)]);
    expect(selection.main.from).toBe(alpha);
  });

  it("does not offer a toggle when only one cursor exists", () => {
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(alpha) });
    expect(createQueryEditorMultiCursorMouseSelection(fakeView(state), eventAt(alpha))).toBeNull();
  });

  it("does not offer a toggle for a click outside every cursor", () => {
    const state = multiCursorState(doc, EditorSelection.create([EditorSelection.cursor(alpha), EditorSelection.cursor(beta)], 0));
    expect(createQueryEditorMultiCursorMouseSelection(fakeView(state), eventAt(doc.indexOf("from")))).toBeNull();
  });

  it("adds the clicked word on a double click", () => {
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(alpha) });
    const style = createQueryEditorMultiCursorMouseSelection(fakeView(state), eventAt(beta + 1, 1, { detail: 2 }));
    expect(style).not.toBeNull();
    const selection = style!.get(eventAt(beta + 1, 1, { detail: 2 }), false, true);
    expect(selection.ranges).toEqual([EditorSelection.cursor(alpha), EditorSelection.range(beta, beta + 4)]);
    expect(selection.main.from).toBe(beta);
  });

  it("adds the word instead of extending the main range when shift is held", () => {
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(alpha) });
    const style = createQueryEditorMultiCursorMouseSelection(fakeView(state), eventAt(beta + 1, 1, { detail: 2 }));
    expect(style).not.toBeNull();
    const selection = style!.get(eventAt(beta + 1, 1, { detail: 2 }), true, true);
    expect(selection.ranges).toEqual([EditorSelection.cursor(alpha), EditorSelection.range(beta, beta + 4)]);
  });

  it("keeps the default double click when there is no word under the pointer", () => {
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(alpha) });
    // The space between the comma and "beta" belongs to no word.
    expect(createQueryEditorMultiCursorMouseSelection(fakeView(state), eventAt(beta - 1, 1, { detail: 2 }))).toBeNull();
  });

  it("accepts Cmd instead of Ctrl", () => {
    const state = multiCursorState(doc, EditorSelection.create([EditorSelection.cursor(alpha), EditorSelection.cursor(beta)], 1));
    const style = createQueryEditorMultiCursorMouseSelection(fakeView(state), eventAt(beta, 1, { ctrlKey: false, metaKey: true }));
    expect(style).not.toBeNull();
    expect(style!.get(eventAt(beta, 1, { ctrlKey: false, metaKey: true }), false, true).ranges).toEqual([EditorSelection.cursor(alpha)]);
  });

  it("keeps the default behaviour for plain clicks, Alt-only clicks and other buttons", () => {
    const state = multiCursorState(doc, EditorSelection.create([EditorSelection.cursor(alpha), EditorSelection.cursor(beta)], 1));
    const view = fakeView(state);
    expect(createQueryEditorMultiCursorMouseSelection(view, eventAt(beta, 1, { altKey: false }))).toBeNull();
    expect(createQueryEditorMultiCursorMouseSelection(view, eventAt(beta, 1, { ctrlKey: false }))).toBeNull();
    expect(createQueryEditorMultiCursorMouseSelection(view, eventAt(beta, 1, { button: 2 }))).toBeNull();
    expect(createQueryEditorMultiCursorMouseSelection(view, eventAt(beta, 1, { detail: 3 }))).toBeNull();
    expect(createQueryEditorMultiCursorMouseSelection(view, eventAt(beta + 1, 1, { detail: 2, altKey: false }))).toBeNull();
    expect(createQueryEditorMultiCursorMouseSelection(view, eventAt(beta), { composing: true })).toBeNull();
  });

  it("is consulted before the rectangular style in the editor's extension order", () => {
    const selection = multiCursorState(doc, EditorSelection.create([EditorSelection.cursor(alpha), EditorSelection.cursor(beta)], 1)).selection;
    const extensions = [
      Prec.highest(EditorView.mouseSelectionStyle.of((view, event) => createQueryEditorMultiCursorMouseSelection(view, event))),
      Prec.highest(EditorView.mouseSelectionStyle.of((view, event) => createQueryEditorStringMouseSelection(view, event, {}))),
      Prec.highest(EditorView.mouseSelectionStyle.of((view, event) => createQueryEditorParenthesisMouseSelection(view, event, {}))),
      rectangularSelection({ eventFilter: startsQueryEditorRectangularSelection }),
    ];
    const state = EditorState.create({ doc, selection, extensions: [EditorState.allowMultipleSelections.of(true), ...extensions] });
    const styles = state.facet(EditorView.mouseSelectionStyle);
    // Three Prec.highest styles first, in registration order, then the
    // rectangular style at default precedence.
    expect(styles).toHaveLength(4);
    const view = fakeView(state);
    const first = styles.slice(0, 3).map((make) => make(view, eventAt(beta))).find(Boolean);
    expect(first).not.toBeUndefined();
    expect(first!.get(eventAt(beta), false, true).ranges).toEqual([EditorSelection.cursor(alpha)]);
  });

  it("maps the captured range when the document changes", () => {
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(alpha) });
    const view = fakeView(state);
    const style = createQueryEditorMultiCursorMouseSelection(view, eventAt(beta + 1, 1, { detail: 2 }))!;
    const transaction = state.update({ changes: { from: 0, insert: " " } });
    style.update({ docChanged: true, changes: transaction.changes, state: transaction.state } as unknown as Parameters<NonNullable<ReturnType<typeof createQueryEditorMultiCursorMouseSelection>>["update"]>[0]);
    const selection = style.get(eventAt(beta + 2, 1, { detail: 2 }), false, true);
    expect(selection.ranges).toEqual([EditorSelection.cursor(alpha + 1), EditorSelection.range(beta + 1, beta + 5)]);
  });
});
