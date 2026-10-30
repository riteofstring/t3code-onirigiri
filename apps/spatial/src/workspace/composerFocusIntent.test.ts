// @vitest-environment jsdom
import { afterEach, expect, it } from "vite-plus/test";
import { retainComposerFocusIntent } from "./composerFocusIntent";

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.replaceChildren();
});
function fixture() {
  const pane = document.createElement("div");
  pane.dataset.onirigiriSlot = "pane";
  pane.dataset.onirigiriPaneId = "destination";
  pane.dataset.focused = "true";
  const live = document.createElement("div");
  live.setAttribute("inert", "");
  const root = document.createElement("div");
  const editor = document.createElement("div");
  editor.dataset.testid = "composer-editor";
  editor.tabIndex = 0;
  editor.textContent = "draft";
  editor.getBoundingClientRect = () => ({ left: 10, right: 100, top: 10, bottom: 50 }) as DOMRect;
  root.append(editor);
  live.append(root);
  pane.append(live);
  document.body.append(pane);
  dispose = retainComposerFocusIntent(root, () => ({ focusAtEnd: () => editor.focus() }));
  const click = (x = 20) => {
    pane.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: 20 }));
    pane.tabIndex = -1;
    pane.focus();
    pane.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: 20 }));
  };
  const key = (key: string) =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  const reveal = async () => {
    live.removeAttribute("inert");
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { pane, live, editor, click, key, reveal };
}
it("hands explicit focus to the ready composer without capturing or replaying early keys", async () => {
  const f = fixture();
  f.click();
  for (const key of ["x", "Backspace", "Enter"]) expect(f.key(key)).toBe(true);
  expect(document.activeElement).toBe(f.pane);
  await f.reveal();
  expect(document.activeElement).toBe(f.editor);
  expect(f.editor.textContent).toBe("draft");
});
it.each(["Tab", "Escape", "click", "focus"] as const)(
  "cancels when %s supersedes the click",
  async (action) => {
    const f = fixture();
    f.click();
    if (action === "click") f.click(200);
    else if (action === "focus") {
      const button = document.createElement("button");
      document.body.append(button);
      button.focus();
    } else f.key(action);
    await f.reveal();
    expect(document.activeElement).not.toBe(f.editor);
  },
);
it("rearming carries only fresh focus intent and never revives canceled input", async () => {
  const f = fixture();
  f.click();
  f.key("x");
  f.click(200);
  f.click();
  await f.reveal();
  expect(document.activeElement).toBe(f.editor);
  expect(f.editor.textContent).toBe("draft");
  f.editor.blur();
  f.live.setAttribute("inert", "");
  f.click();
  f.key("Escape");
  await f.reveal();
  expect(document.activeElement).not.toBe(f.editor);
  expect(f.editor.textContent).toBe("draft");
});
it.each(["selection", "destination", "dispose"] as const)(
  "cancels on leaving the pane through %s",
  async (leave) => {
    const f = fixture();
    f.click();
    if (leave === "selection") f.pane.dataset.focused = "false";
    else if (leave === "destination") f.pane.dataset.onirigiriPaneId = "other";
    else dispose();
    await f.reveal();
    expect(document.activeElement).not.toBe(f.editor);
  },
);
