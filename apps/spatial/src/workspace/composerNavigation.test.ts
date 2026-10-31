// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { COMPOSER_NAVIGATION, installComposerNavigation } from "./composerNavigation";

let editor: HTMLDivElement;
let cleanup: () => void;
let navigate: ReturnType<typeof vi.fn<(direction: string) => void>>;

function caret(node: Node, offset: number, end = offset) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, end);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
}
function key(key = "ArrowRight", extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    altKey: true,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  editor.dispatchEvent(event);
  return event;
}
beforeEach(() => {
  editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.dataset.testid = "composer-editor";
  editor.innerHTML = '<p><br class="ProseMirror-trailingBreak"></p>';
  document.body.append(editor);
  navigate = vi.fn();
  cleanup = installComposerNavigation({ enabled: () => true, navigate });
  caret(editor.firstChild!, 0);
});
afterEach(() => {
  cleanup();
  editor.remove();
  vi.restoreAllMocks();
});
it("navigates repeatedly from an empty focused stock composer and signals arrival intent", () => {
  const intent = vi.fn();
  window.addEventListener(COMPOSER_NAVIGATION, intent);
  for (const arrow of ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) {
    expect(key(arrow).defaultPrevented).toBe(true);
  }
  expect(navigate.mock.calls.flat()).toEqual(["right", "right", "left", "up", "down"]);
  expect(intent).toHaveBeenCalledTimes(5);
  window.removeEventListener(COMPOSER_NAVIGATION, intent);
});
it("navigates from an empty composer before its selection reaches the editor", () => {
  const outside = document.createElement("div");
  document.body.append(outside);
  caret(outside, 0);
  expect(key("ArrowRight").defaultPrevented).toBe(true);
  expect(navigate).toHaveBeenCalledWith("right");
  getSelection()!.removeAllRanges();
  expect(key("ArrowLeft").defaultPrevented).toBe(true);
  expect(navigate).toHaveBeenCalledWith("left");
  outside.remove();
});
it("leaves a filled composer to the editor while its selection is elsewhere", () => {
  const outside = document.createElement("div");
  document.body.append(outside);
  for (const content of ["<p>alpha</p>", "<p><br></p><p><br></p>"]) {
    editor.innerHTML = content;
    caret(outside, 0);
    for (const arrow of ["ArrowLeft", "ArrowRight"])
      expect(key(arrow).defaultPrevented).toBe(false);
  }
  expect(navigate).not.toHaveBeenCalled();
  outside.remove();
});
it("preserves native middle movement and only exits at the document's directional boundary", () => {
  editor.innerHTML = "<p>alpha bravo</p><p>charlie delta</p>";
  const first = editor.firstChild!.firstChild!,
    last = editor.lastChild!.firstChild!;
  caret(first, 6);
  for (const arrow of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])
    expect(key(arrow).defaultPrevented).toBe(false);
  caret(last, 0);
  expect(key("ArrowLeft").defaultPrevented).toBe(false);
  caret(first, 0);
  expect(key("ArrowLeft").defaultPrevented).toBe(true);
  expect(key("ArrowUp").defaultPrevented).toBe(true);
  expect(key("ArrowRight").defaultPrevented).toBe(false);
  caret(last, last.textContent!.length);
  expect(key("ArrowRight").defaultPrevented).toBe(true);
  expect(key("ArrowDown").defaultPrevented).toBe(true);
  expect(key("ArrowUp").defaultPrevented).toBe(false);
});
it("treats inline atoms and empty paragraphs as document content", () => {
  editor.innerHTML = '<p></p><p><span contenteditable="false">mention</span>text</p><p></p>';
  const text = editor.children[1]!.lastChild!;
  caret(text, 0);
  expect(key("ArrowLeft").defaultPrevented).toBe(false);
  caret(text, 4);
  expect(key("ArrowRight").defaultPrevented).toBe(false);
});
it("ignores ProseMirror cursor helpers after a trailing inline atom", () => {
  editor.innerHTML =
    '<p><span contenteditable="false">mention</span><img class="ProseMirror-separator"><br class="ProseMirror-trailingBreak"></p>';
  caret(editor.firstChild!, 1);
  expect(key("ArrowRight").defaultPrevented).toBe(true);
  expect(key("ArrowDown").defaultPrevented).toBe(true);
});

it("uses Shift to leave the middle but delivers selections and composition to the editor", () => {
  editor.innerHTML = "<p>alpha bravo</p>";
  const text = editor.firstChild!.firstChild!;
  caret(text, 6);
  expect(key("ArrowRight", { shiftKey: true }).defaultPrevented).toBe(true);
  caret(text, 1, 5);
  const native = vi.fn();
  editor.addEventListener("keydown", native);
  expect(key("ArrowRight", { shiftKey: true }).defaultPrevented).toBe(false);
  caret(text, 6);
  expect(key("ArrowRight", { shiftKey: true, isComposing: true }).defaultPrevented).toBe(false);
  editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  expect(key("ArrowRight", { shiftKey: true }).defaultPrevented).toBe(false);
  editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  expect(key("ArrowRight", { shiftKey: true }).defaultPrevented).toBe(true);
  expect(native).toHaveBeenCalledTimes(3);
});
it("leaves unrelated inputs and modified chords to their owner", () => {
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { modifierAltGraph: true }])
    expect(key("ArrowRight", extra).defaultPrevented).toBe(false);
  editor.removeAttribute("data-testid");
  expect(key().defaultPrevented).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
});
