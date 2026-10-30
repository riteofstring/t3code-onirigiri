// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { retainEarlyComposerInput } from "./earlyComposerInput";

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.replaceChildren();
});

function fixture() {
  const pane = document.createElement("div");
  pane.dataset.onirigiriSlot = "pane";
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
  const handle = {
    insertTextAtEnd: (text: string) => {
      editor.textContent += text;
      return true;
    },
    focusAtEnd: () => editor.focus(),
  };
  dispose = retainEarlyComposerInput(root, () => handle);
  const click = (x = 20) =>
    pane.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: 20 }));
  const key = (key: string) =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  const reveal = async () => {
    live.removeAttribute("inert");
    await vi.waitFor(() => expect(document.activeElement).toBe(editor));
  };
  return { editor, click, key, reveal, live };
}

it("retains keys from a click on the covered composer and delivers them once it is interactive", async () => {
  const { editor, click, key, reveal, live } = fixture();
  click();
  expect(key("x")).toBe(false);
  expect(key("y")).toBe(false);
  expect(key("Backspace")).toBe(false);
  expect(editor.textContent).toBe("draft");
  await reveal();
  expect(editor.textContent).toBe("draftx");
  live.setAttribute("data-other", "changed");
  await Promise.resolve();
  expect(editor.textContent).toBe("draftx");
});

it("does not redirect typing without a composer click or after leaving the pane", async () => {
  const { editor, click, key, live } = fixture();
  expect(key("x")).toBe(true);
  click(200);
  expect(key("y")).toBe(true);
  click();
  key("z");
  dispose();
  live.removeAttribute("inert");
  await Promise.resolve();
  expect(editor.textContent).toBe("draft");
});
