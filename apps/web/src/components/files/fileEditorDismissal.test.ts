// @vitest-environment jsdom
import { clearRenderQueue, File, getSharedHighlighter } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { installFileEditorDismissal } from "./fileEditorDismissal";

const disposals: (() => void)[] = [];
const frames = new Set<ReturnType<typeof setImmediate>>();
let errors: unknown[];

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ["pierre-dark"],
    langs: ["text"],
    preferredHighlighter: "shiki-wasm",
  });
});

beforeEach(() => {
  errors = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.error);
    event.preventDefault();
  };
  window.addEventListener("error", onError);
  disposals.push(() => window.removeEventListener("error", onError));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const frame = setImmediate(() => {
      frames.delete(frame);
      callback(0);
    });
    frames.add(frame);
    return frame;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame: ReturnType<typeof setImmediate>) => {
    frames.delete(frame);
    clearImmediate(frame);
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  Object.defineProperty(CSSStyleSheet.prototype, "replaceSync", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
});

afterEach(() => {
  for (const dispose of disposals.splice(0).toReversed()) dispose();
  clearRenderQueue();
  for (const frame of frames) clearImmediate(frame);
  frames.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(CSSStyleSheet.prototype, "replaceSync");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function makeFile() {
  const root = document.createElement("div");
  const container = document.createElement("diffs-container");
  const outside = document.createElement("button");
  root.append(container);
  document.body.append(root, outside);
  let onAttach!: () => void;
  const attached = new Promise<void>((resolve) => {
    onAttach = resolve;
  });
  const editor = new Editor("file", { onAttach: () => onAttach() });
  const file = new File({
    theme: "pierre-dark",
    themeType: "dark",
    preferredHighlighter: "shiki-wasm",
    disableFileHeader: true,
  });
  file.render({
    fileContainer: container,
    file: { name: "notes.txt", contents: "Keep this editable.\n", cacheKey: "notes" },
  });
  editor.edit(file);
  disposals.push(
    () => file.cleanUp(),
    () => editor.cleanUp(),
  );
  const onDismiss = vi.fn();
  let blocked = false;
  const uninstall = installFileEditorDismissal({
    root,
    editor,
    isBlocked: () => blocked,
    onDismiss,
  });
  disposals.push(uninstall);
  return {
    editor,
    outside,
    root,
    container,
    onDismiss,
    attached,
    block: () => {
      blocked = true;
    },
    uninstall,
    select: () =>
      editor.setSelections([
        { direction: "forward", start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
      ]),
    focus: () => {
      const content = container.shadowRoot!.querySelector<HTMLElement>("[data-content]")!;
      content.tabIndex = 0;
      content.focus();
      return content;
    },
    clickOutside: () =>
      outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true })),
  };
}

describe("file editor dismissal", () => {
  it("still clears an initialized editor selection on an outside click", async () => {
    const view = makeFile();
    await view.attached;
    view.select();
    expect(view.editor.getViewState().selections).toHaveLength(1);
    view.clickOutside();
    expect(view.editor.getViewState().selections).toBeUndefined();
    expect(view.onDismiss).toHaveBeenCalledOnce();
    expect(errors).toEqual([]);
  });

  it("keeps selections for clicks inside the editor or while a comment form is open", async () => {
    const view = makeFile();
    await view.attached;
    view.select();
    const content = view.focus();
    content.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    expect(view.editor.getViewState().selections).toHaveLength(1);
    view.block();
    view.clickOutside();
    expect(view.editor.getViewState().selections).toHaveLength(1);
    expect(view.onDismiss).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("dismisses Escape only when focus belongs to the editor", async () => {
    const view = makeFile();
    await view.attached;
    view.select();
    view.outside.focus();
    const outsideEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    view.outside.dispatchEvent(outsideEscape);
    expect(outsideEscape.defaultPrevented).toBe(false);
    expect(view.editor.getViewState().selections).toHaveLength(1);
    const content = view.focus();
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    content.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(view.editor.getViewState().selections).toBeUndefined();
    expect(view.container.shadowRoot?.activeElement).toBeNull();
    expect(errors).toEqual([]);
  });

  it("removes document listeners when the file surface closes", async () => {
    const view = makeFile();
    await view.attached;
    view.select();
    view.uninstall();
    view.clickOutside();
    const content = view.focus();
    content.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
    expect(view.onDismiss).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });
});
