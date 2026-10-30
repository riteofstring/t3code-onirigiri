import type { WorkspaceFocusedPaneFrame } from "@riteofstring/onirigiri";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "@t3tools/web/src/components/ComposerPromptEditor";
import { useComposerDraftStore } from "@t3tools/web/src/composerDraftStore";
import { useImperativeHandle, useRef, type Ref } from "react";

import type { ThreadPaneData } from "./useWorkspacePanes";

export interface PersistentComposerHandle {
  bind: (paneId: string, thread: ThreadPaneData, focus: boolean) => boolean;
  frame: (frame: WorkspaceFocusedPaneFrame | null, moving: boolean) => void;
  hide: () => void;
}

const EMPTY_CONTEXT = new Map();
const EMPTY_SKILLS: [] = [];

export function PersistentComposer({ ref }: { ref: Ref<PersistentComposerHandle> }) {
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<ComposerPromptEditorHandle>(null);
  const destination = useRef<string | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      bind(paneId, thread, focus) {
        if (!root.current || !editor.current?.bindDraft) return false;
        if (destination.current === paneId) {
          if (focus) editor.current.focus();
          return true;
        }
        const threadRef = scopeThreadRef(thread.environmentId, thread.threadId);
        const draft =
          useComposerDraftStore.getState().draftsByThreadKey[scopedThreadKey(threadRef)];
        const value = draft?.prompt ?? "";
        const bound = editor.current.bindDraft(value, Number.POSITIVE_INFINITY, (next) => {
          useComposerDraftStore.getState().setPrompt(threadRef, next);
        });
        if (!bound) return false;
        destination.current = paneId;
        root.current.dataset.composerDestination = paneId;
        root.current.hidden = false;
        if (focus) editor.current.focus();
        return true;
      },
      frame(frame, moving) {
        const element = root.current;
        if (!element) return;
        if (!frame || destination.current !== frame.paneId) {
          element.hidden = true;
          return;
        }
        element.hidden = false;
        element.style.left = `${frame.x}px`;
        element.style.top = `${frame.y}px`;
        element.style.width = `${frame.width}px`;
        element.style.height = `${frame.height}px`;
        element.dataset.moving = String(moving);
      },
      hide() {
        if (root.current) root.current.hidden = true;
      },
    }),
    [],
  );
  return (
    <div
      ref={root}
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
          onCommandKeyDown={(key) => key === "Enter"}
        />
      </div>
    </div>
  );
}
