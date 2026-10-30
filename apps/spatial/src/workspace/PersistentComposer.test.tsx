// @vitest-environment jsdom
import type { ChatComposerHandle } from "@t3tools/web/src/components/chat/ChatComposer";
import { registerPaneComposer } from "./paneComposerRelay";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useComposerDraftStore } from "@t3tools/web/src/composerDraftStore";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { PersistentComposer, type PersistentComposerHandle } from "./PersistentComposer";

it("writes intent-time input only to the bound environment and thread, including on reversal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const handle = createRef<PersistentComposerHandle>();
  const a = { environmentId: "overlay-a" as EnvironmentId, threadId: "same" as ThreadId };
  const b = { environmentId: "overlay-b" as EnvironmentId, threadId: "same" as ThreadId };
  const refA = scopeThreadRef(a.environmentId, a.threadId);
  const refB = scopeThreadRef(b.environmentId, b.threadId);
  const store = useComposerDraftStore.getState();
  store.setPrompt(refA, "short");
  store.setPrompt(refB, "**long**\n\n".repeat(100));
  try {
    await act(async () => root.render(<PersistentComposer ref={handle} />));
    const editor = container.querySelector<
      HTMLElement & {
        editor: { commands: { insertContent: (value: string) => boolean; undo: () => boolean } };
      }
    >(".tiptap")!.editor;
    await act(async () => {
      handle.current!.bind("a", a, false);
      handle.current!.flush();
      editor.commands.insertContent("x");
    });
    await act(async () => root.render(<PersistentComposer ref={handle} />));
    await act(async () => {
      editor.commands.insertContent("r");
      handle.current!.bind("b", b, false);
      handle.current!.flush();
      editor.commands.insertContent("y");
      handle.current!.bind("a", a, false);
      handle.current!.flush();
      expect(editor.commands.undo()).toBe(false);
      editor.commands.insertContent("z");
    });
    const drafts = useComposerDraftStore.getState().draftsByThreadKey;
    expect(drafts[scopedThreadKey(refA)]?.prompt).toBe("shortxrz");
    expect(drafts[scopedThreadKey(refB)]?.prompt).toBe(`${"**long**\n\n".repeat(100)}y`);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps document work out of intent and flushes it before the first key or at settle", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const handle = createRef<PersistentComposerHandle>();
  const thread = { environmentId: "overlay-flush" as EnvironmentId, threadId: "draft" as ThreadId };
  useComposerDraftStore
    .getState()
    .setPrompt(scopeThreadRef(thread.environmentId, thread.threadId), "destination");
  try {
    await act(async () => root.render(<PersistentComposer ref={handle} />));
    const editor = container.querySelector<HTMLElement>(".tiptap")!;
    await act(async () => {
      expect(handle.current!.bind("first", thread, false)).toBe(true);
      handle.current!.frame(
        { paneId: "first", x: 0, y: 0, width: 800, height: 600, scale: 1 },
        true,
      );
      expect(editor.textContent).toBe("");
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
      expect(editor.textContent).toBe("destination");
      useComposerDraftStore
        .getState()
        .setPrompt(scopeThreadRef(thread.environmentId, thread.threadId), "settled");
      expect(handle.current!.bind("second", thread, false)).toBe(true);
      expect(editor.textContent).toBe("settled");
      handle.current!.frame(
        { paneId: "second", x: 0, y: 0, width: 800, height: 600, scale: 1 },
        false,
      );
      expect(editor.textContent).toBe("settled");
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("leaves the overlay on Escape while respecting composition", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const handle = createRef<PersistentComposerHandle>();
  const thread = {
    environmentId: "overlay-escape" as EnvironmentId,
    threadId: "draft" as ThreadId,
  };
  try {
    await act(async () => root.render(<PersistentComposer ref={handle} />));
    await act(async () => {
      handle.current!.bind("escape", thread, true);
      handle.current!.frame(
        { paneId: "escape", x: 0, y: 0, width: 800, height: 600, scale: 1 },
        false,
      );
    });
    const editor = container.querySelector<HTMLElement>('[data-testid="composer-editor"]')!;
    editor.focus();
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(editor);
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.activeElement).not.toBe(editor);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("never queues unavailable Enter and relays only to the scoped destination", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const overlay = createRef<PersistentComposerHandle>();
  const a = { environmentId: "send-a" as EnvironmentId, threadId: "same" as ThreadId };
  const b = { environmentId: "send-b" as EnvironmentId, threadId: "same" as ThreadId };
  const refA = scopeThreadRef(a.environmentId, a.threadId);
  const refB = scopeThreadRef(b.environmentId, b.threadId);
  useComposerDraftStore.getState().setPrompt(refA, "first");
  useComposerDraftStore.getState().setPrompt(refB, "second");
  const turns: string[] = [];
  let busy = false;
  const fixture = {
    current: {
      getSendDisabledReason: () => (busy ? "Sending" : null),
      submit: () => {
        if (busy) return;
        busy = true;
        turns.push(useComposerDraftStore.getState().getComposerDraft(refB)!.prompt);
      },
    } as ChatComposerHandle,
  };
  const unregister = registerPaneComposer("send-b", scopedThreadKey(refB), fixture);
  const enter = (element: HTMLElement, composing = false) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: composing,
      }),
    );
  try {
    await act(async () => root.render(<PersistentComposer ref={overlay} />));
    const element = container.querySelector<HTMLElement>(".tiptap")!;
    await act(async () => {
      overlay.current!.bind("send-a", a, false);
      enter(element);
    });
    expect(container.textContent).toContain("Preparing");
    expect(turns).toEqual([]);
    await act(async () => {
      overlay.current!.bind("send-b", b, false);
      enter(element, true);
    });
    expect(turns).toEqual([]);
    await act(async () => {
      overlay.current!.flush();
      (
        element as HTMLElement & { editor: { commands: { insertContent: (text: string) => void } } }
      ).editor.commands.insertContent(" fresh");
      enter(element);
      enter(element);
    });
    expect(turns).toEqual(["second fresh"]);
    expect(useComposerDraftStore.getState().getComposerDraft(refA)!.prompt).toBe("first");
    expect(container.textContent).toContain("Sending");
  } finally {
    unregister();
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("reflects external clears and restoration synchronously without resetting self-authored caret", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const overlay = createRef<PersistentComposerHandle>();
  const thread = { environmentId: "external" as EnvironmentId, threadId: "draft" as ThreadId };
  const target = scopeThreadRef(thread.environmentId, thread.threadId);
  const store = useComposerDraftStore.getState();
  store.setPrompt(target, "original");
  try {
    await act(async () => root.render(<PersistentComposer ref={overlay} />));
    const element = container.querySelector<
      HTMLElement & {
        editor: {
          commands: {
            insertContent: (text: string) => void;
            setTextSelection: (position: number) => void;
          };
        };
      }
    >(".tiptap")!;
    await act(async () => {
      overlay.current!.bind("external", thread, false);
      overlay.current!.flush();
      element.editor.commands.setTextSelection(1);
      element.editor.commands.insertContent("a");
      element.editor.commands.insertContent("b");
      expect(element.textContent).toBe("aboriginal");
      store.clearComposerContent(target);
      expect(element.textContent).toBe("");
      store.setPrompt(target, "restored");
      expect(element.textContent).toBe("restored");
      element.editor.commands.insertContent("!");
      expect(store.getComposerDraft(target)!.prompt).toBe("restored!");
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps text paste native and captures file paste at the originating pane", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const overlay = createRef<PersistentComposerHandle>();
  const a = { environmentId: "paste-a" as EnvironmentId, threadId: "same" as ThreadId };
  const b = { environmentId: "paste-b" as EnvironmentId, threadId: "same" as ThreadId };
  const refA = scopeThreadRef(a.environmentId, a.threadId);
  const refB = scopeThreadRef(b.environmentId, b.threadId);
  let finish: () => void = () => {};
  const fixture = {
    current: {
      addDroppedFiles: (files: File[]) => {
        finish = () =>
          useComposerDraftStore.getState().setPrompt(refA, `prepared ${files[0]!.name}`);
      },
    } as ChatComposerHandle,
  };
  const paste = (element: HTMLElement, files: File[]) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        files,
        getData: () => "native text",
        types: files.length ? ["Files"] : ["text/plain"],
      },
    });
    element.dispatchEvent(event);
    return event;
  };
  let unregister = () => {};
  try {
    await act(async () => root.render(<PersistentComposer ref={overlay} />));
    const element = container.querySelector<HTMLElement>(".tiptap")!;
    await act(async () => {
      overlay.current!.bind("paste-a", a, false);
      overlay.current!.flush();
      expect(paste(element, []).defaultPrevented).toBe(true);
      expect(useComposerDraftStore.getState().getComposerDraft(refA)!.prompt).toBe("native text");
      paste(element, [new File(["pixels"], "first.png", { type: "image/png" })]);
    });
    expect(container.textContent).toContain("Preparing");
    unregister = registerPaneComposer("paste-a", scopedThreadKey(refA), fixture);
    await act(async () => {
      paste(element, [new File(["pixels"], "origin.png", { type: "image/png" })]);
      overlay.current!.bind("paste-b", b, false);
      overlay.current!.flush();
      finish();
    });
    expect(useComposerDraftStore.getState().getComposerDraft(refA)!.prompt).toBe(
      "prepared origin.png",
    );
    expect(useComposerDraftStore.getState().getComposerDraft(refB)?.prompt ?? "").toBe("");
    expect(element.textContent).toBe("");
  } finally {
    unregister();
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("aligns only to the editor and yields to stock pending-answer input", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  const paint = () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback(0);
  };
  const container = document.createElement("div");
  const pane = document.createElement("div");
  pane.dataset.spatialPaneId = "region";
  const region = document.createElement("div");
  region.dataset.paneComposerEditor = "";
  const stockEditor = document.createElement("div");
  stockEditor.setAttribute("contenteditable", "true");
  region.append(stockEditor);
  const send = document.createElement("button");
  const sent = vi.fn();
  send.addEventListener("click", sent);
  pane.append(region, send);
  document.body.append(container, pane);
  vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 800, 600));
  vi.spyOn(region, "getBoundingClientRect").mockReturnValue(new DOMRect(180, 520, 640, 60));
  const root = createRoot(container);
  const overlay = createRef<PersistentComposerHandle>();
  const thread = { environmentId: "region" as EnvironmentId, threadId: "draft" as ThreadId };
  const unregister = registerPaneComposer(
    "region",
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.threadId)),
    { current: null },
    { current: pane },
  );
  try {
    await act(async () => root.render(<PersistentComposer ref={overlay} />));
    await act(async () => {
      overlay.current!.bind("region", thread, true);
      overlay.current!.frame(
        { paneId: "region", x: 0, y: 0, width: 800, height: 600, scale: 1 },
        false,
      );
      paint();
    });
    const surface = container.querySelector<HTMLElement>('[data-aligned="true"]')!;
    expect(surface.style.left).toBe("10%");
    expect(surface.style.top).toBe("70%");
    expect(surface.style.width).toBe("80%");
    expect(surface.style.height).toBe("10%");
    send.click();
    expect(sent).toHaveBeenCalledOnce();
    await act(async () => {
      region.dataset.composerInputOwner = "stock";
    });
    await act(async () => paint());
    expect(container.querySelector<HTMLElement>("[data-persistent-composer]")!.hidden).toBe(true);
    expect(document.activeElement).toBe(stockEditor);
    await act(async () => {
      delete region.dataset.composerInputOwner;
    });
    await act(async () => paint());
    expect(container.querySelector<HTMLElement>("[data-persistent-composer]")!.hidden).toBe(false);
    expect(document.activeElement).toBe(container.querySelector(".tiptap"));
  } finally {
    unregister();
    await act(async () => root.unmount());
    container.remove();
    pane.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
