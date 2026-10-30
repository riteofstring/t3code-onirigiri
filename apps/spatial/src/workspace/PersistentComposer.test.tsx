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
      editor.commands.insertContent("x");
      handle.current!.bind("b", b, false);
      editor.commands.insertContent("y");
      handle.current!.bind("a", a, false);
      expect(editor.commands.undo()).toBe(false);
      editor.commands.insertContent("z");
    });
    const drafts = useComposerDraftStore.getState().draftsByThreadKey;
    expect(drafts[scopedThreadKey(refA)]?.prompt).toBe("shortxz");
    expect(drafts[scopedThreadKey(refB)]?.prompt).toBe(`${"**long**\n\n".repeat(100)}y`);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
