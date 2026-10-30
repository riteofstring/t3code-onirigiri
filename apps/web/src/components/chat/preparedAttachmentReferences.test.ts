import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { composerTargetKey, useComposerDraftStore } from "../../composerDraftStore";
import {
  collectInlineContextIds,
  stripInlineContextReferences,
} from "../../lib/composerContextReferences";
import { insertPreparedAttachmentReferences } from "./preparedAttachmentReferences";

const source = scopeThreadRef(EnvironmentId.make("source"), ThreadId.make("same-thread"));
const destination = scopeThreadRef(EnvironmentId.make("destination"), ThreadId.make("same-thread"));
const references = [{ kind: "image" as const, contextId: "image_prepared", label: "paste.png" }];

beforeEach(() => {
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
});

describe("prepared attachment references", () => {
  it("finishes in the originating environment after navigation during preparation", async () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(source, "source text");
    store.setPrompt(destination, "destination text");
    let currentTargetKey = composerTargetKey(source);
    const insertAtCaret = vi.fn(() => true);
    let finishPreparation!: () => void;
    const prepared = new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    const paste = (async () => {
      await prepared;
      return insertPreparedAttachmentReferences({
        target: source,
        currentTargetKey,
        references,
        insertAtCaret,
      });
    })();

    currentTargetKey = composerTargetKey(destination);
    store.setPrompt(source, "source text edited while preparing");
    finishPreparation();
    expect(await paste).toBe(true);
    const result = useComposerDraftStore.getState();
    const sourcePrompt = result.getComposerDraft(source)?.prompt ?? "";
    expect(stripInlineContextReferences(sourcePrompt).trim()).toBe(
      "source text edited while preparing",
    );
    expect(collectInlineContextIds(sourcePrompt)).toEqual(["image_prepared"]);
    expect(result.getComposerDraft(destination)?.prompt).toBe("destination text");
    expect(insertAtCaret).not.toHaveBeenCalled();
  });
});

it("appends covered-editor chips to the latest draft without reading its stale caret", () => {
  const store = useComposerDraftStore.getState();
  store.setPrompt(source, "typed before the pane rendered");
  store.setPrompt(destination, "other environment");
  expect(
    insertPreparedAttachmentReferences({
      target: source,
      currentTargetKey: composerTargetKey(source),
      references,
    }),
  ).toBe(true);
  const prompt = store.getComposerDraft(source)!.prompt;
  expect(stripInlineContextReferences(prompt).trim()).toBe("typed before the pane rendered");
  expect(collectInlineContextIds(prompt)).toEqual(["image_prepared"]);
  expect(store.getComposerDraft(destination)!.prompt).toBe("other environment");
});
