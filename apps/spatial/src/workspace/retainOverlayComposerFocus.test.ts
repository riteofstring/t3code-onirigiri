// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { retainOverlayComposerFocus } from "./retainOverlayComposerFocus";

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.replaceChildren();
});

function fixture() {
  const root = document.createElement("div");
  root.dataset.composerDestination = "a";
  root.dataset.moving = "true";
  const editor = document.createElement("div");
  editor.dataset.testid = "composer-editor";
  editor.tabIndex = 0;
  editor.getBoundingClientRect = () => ({ left: 10, right: 100, top: 10, bottom: 50 }) as DOMRect;
  root.append(editor);
  document.body.append(root);
  const focus = vi.fn(() => editor.focus());
  dispose = retainOverlayComposerFocus(root, focus);
  const click = (x = 20) => {
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    document.body.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: x, clientY: 20 }),
    );
  };
  const settle = async () => {
    root.dataset.moving = "false";
    await Promise.resolve();
  };
  return { root, editor, focus, click, settle };
}

it("delivers a composer click during flight once settled without replaying keys", async () => {
  const f = fixture();
  f.click();
  expect(f.focus).not.toHaveBeenCalled();
  await f.settle();
  expect(document.activeElement).toBe(f.editor);
  expect(f.focus).toHaveBeenCalledOnce();
});

it.each(["Tab", "Escape", "click", "focus", "reversal", "far jump", "hide"])(
  "lets %s supersede the pending click",
  async (action) => {
    const f = fixture();
    f.click();
    if (action === "click") f.click(200);
    else if (action === "focus") {
      const button = document.createElement("button");
      document.body.append(button);
      button.focus();
    } else if (action === "reversal" || action === "far jump") {
      f.root.dataset.composerDestination = action;
      if (action === "reversal") f.root.dataset.composerDestination = "a";
    } else if (action === "hide") f.root.hidden = true;
    else window.dispatchEvent(new KeyboardEvent("keydown", { key: action }));
    await f.settle();
    expect(f.focus).not.toHaveBeenCalled();
  },
);
