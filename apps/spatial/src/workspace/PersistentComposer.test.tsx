// @vitest-environment jsdom
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
      expect(editor.textContent).toBe("destination");
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
