import {
  composerTargetKey,
  useComposerDraftStore,
  type ComposerThreadTarget,
} from "../../composerDraftStore";
import {
  ensureInlineContextReferences,
  type ComposerContextReference,
} from "../../lib/composerContextReferences";

export function insertPreparedAttachmentReferences({
  target,
  currentTargetKey,
  references,
  insertAtCaret,
}: {
  target: ComposerThreadTarget;
  currentTargetKey: string;
  references: ReadonlyArray<ComposerContextReference>;
  insertAtCaret: (references: ReadonlyArray<ComposerContextReference>) => boolean;
}): boolean {
  if (references.length === 0) return false;
  if (composerTargetKey(target) === currentTargetKey) return insertAtCaret(references);

  // The editor and prompt refs now belong to another destination. Finish the
  // originating draft without reading or focusing that editor.
  const store = useComposerDraftStore.getState();
  const prompt = store.getComposerDraft(target)?.prompt ?? "";
  store.setPrompt(target, ensureInlineContextReferences(prompt, references));
  return true;
}
