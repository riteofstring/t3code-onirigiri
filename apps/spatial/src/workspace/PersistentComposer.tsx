import { setCoveredComposerOwner } from "@t3tools/web/src/components/coveredComposer";
import type { WorkspaceFocusedPaneFrame } from "@riteofstring/onirigiri";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "@t3tools/web/src/components/ComposerPromptEditor";
import { useComposerDraftStore } from "@t3tools/web/src/composerDraftStore";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import { getPaneComposer } from "./paneComposerRelay";
import { retainOverlayComposerFocus } from "./retainOverlayComposerFocus";

import type { ThreadPaneData } from "./useWorkspacePanes";

export interface PersistentComposerHandle {
  bind: (paneId: string, thread: ThreadPaneData, focus: boolean) => boolean;
  frame: (frame: WorkspaceFocusedPaneFrame | null, moving: boolean) => void;
  hide: () => void;
  flush: () => boolean;
  isComposing: () => boolean;
}

const EMPTY_CONTEXT = new Map();
const EMPTY_SKILLS: [] = [];

export function PersistentComposer({ ref }: { ref: Ref<PersistentComposerHandle> }) {
  useEffect(() => () => setCoveredComposerOwner(null), []);
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<ComposerPromptEditorHandle>(null);
  useEffect(() => {
    if (root.current)
      return retainOverlayComposerFocus(root.current, () => editor.current?.focus());
  }, []);
  const destination = useRef<string | null>(null);
  const boundThreadKey = useRef<string | null>(null);
  const [sendReason, setSendReason] = useState<string | null>(null);
  const getDestinationHandle = () => {
    const paneId = destination.current;
    const key = boundThreadKey.current;
    return paneId && key ? getPaneComposer(paneId, key) : null;
  };
  const pending = useRef<{ paneId: string; thread: ThreadPaneData; value: string } | null>(null);
  const flush = useCallback(() => {
    const next = pending.current;
    if (!next) return true;
    if (!editor.current?.bindDraft) return false;
    const threadRef = scopeThreadRef(next.thread.environmentId, next.thread.threadId);
    const bound = editor.current.bindDraft(next.value, Number.POSITIVE_INFINITY, (value) => {
      useComposerDraftStore.getState().setPrompt(threadRef, value);
    });
    if (bound) pending.current = null;
    return bound;
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      bind(paneId, thread, focus) {
        if (!root.current || !editor.current?.bindDraft) return false;
        if (destination.current === paneId) {
          setCoveredComposerOwner(
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.threadId)),
          );
          if (focus) editor.current.focus();
          return true;
        }
        const threadRef = scopeThreadRef(thread.environmentId, thread.threadId);
        const draft =
          useComposerDraftStore.getState().draftsByThreadKey[scopedThreadKey(threadRef)];
        const value = draft?.prompt ?? "";
        if (editor.current.isComposing?.()) return false;
        pending.current = { paneId, thread, value };
        destination.current = paneId;
        boundThreadKey.current = scopedThreadKey(threadRef);
        setSendReason(null);
        setCoveredComposerOwner(scopedThreadKey(threadRef));
        root.current.dataset.composerDestination = paneId;
        root.current.hidden = false;
        if (focus) editor.current.focus();
        return true;
      },
      flush,
      isComposing: () => editor.current?.isComposing?.() ?? false,
      frame(frame, moving) {
        const element = root.current;
        if (!element) return;
        if (!frame || destination.current !== frame.paneId) {
          element.hidden = true;
          setCoveredComposerOwner(null);
          return;
        }
        if (!moving) flush();
        element.hidden = false;
        element.style.left = `${frame.x}px`;
        element.style.top = `${frame.y}px`;
        element.style.width = `${frame.width}px`;
        element.style.height = `${frame.height}px`;
        element.dataset.moving = String(moving);
      },
      hide() {
        if (root.current) root.current.hidden = true;
        destination.current = null;
        setCoveredComposerOwner(null);
      },
    }),
    [flush],
  );
  return (
    <div
      ref={root}
      onKeyDownCapture={(event) => {
        if (
          event.key === "Escape" &&
          !event.nativeEvent.isComposing &&
          event.target instanceof HTMLElement &&
          !event.target.hasAttribute("aria-controls")
        ) {
          event.preventDefault();
          event.target.blur();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.stopPropagation();
          if (
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229 ||
            editor.current?.isComposing?.()
          )
            return;
          event.preventDefault();
          if (!flush()) {
            setSendReason("Preparing");
            return;
          }
          const handle = getDestinationHandle();
          const reason = handle ? handle.getSendDisabledReason() : "Preparing";
          setSendReason(reason);
          if (!reason) handle?.submit();
          return;
        }
        if (!event.altKey && !event.metaKey && !event.ctrlKey && !flush()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      hidden
      className="group pointer-events-none absolute z-20 overflow-hidden"
      data-persistent-composer=""
    >
      <div className="pointer-events-auto group-data-[moving=true]:pointer-events-none absolute inset-x-3 bottom-3 max-h-[70%] overflow-y-auto rounded-xl border bg-background p-4 shadow-sm">
        <ComposerPromptEditor
          editorRef={editor}
          imperativeBinding
          value=""
          cursor={0}
          richTextEnabled
          contextRecords={EMPTY_CONTEXT}
          skills={EMPTY_SKILLS}
          disabled={false}
          placeholder="Message"
          onChange={() => {}}
          onPaste={(event) => event.preventDefault()}
          onCommandKeyDown={(key, event) => key === "Enter" && !event.shiftKey}
        />
        {sendReason ? <div role="status">{sendReason}</div> : null}
      </div>
    </div>
  );
}
