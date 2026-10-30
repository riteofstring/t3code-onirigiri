import { setCoveredComposerOwner } from "@t3tools/web/src/components/coveredComposer";
import type { WorkspaceFocusedPaneFrame } from "@riteofstring/onirigiri";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "@t3tools/web/src/components/ComposerPromptEditor";
import { useComposerDraftStore } from "@t3tools/web/src/composerDraftStore";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import { getPaneComposer, getPaneComposerEditor, subscribePaneComposer } from "./paneComposerRelay";
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
  const surface = useRef<HTMLDivElement>(null);
  const yielded = useRef(false);
  useEffect(() => {
    if (root.current)
      return retainOverlayComposerFocus(root.current, () => editor.current?.focus());
  }, []);
  const destination = useRef<string | null>(null);
  const boundThreadKey = useRef<string | null>(null);
  const boundThread = useRef<ThreadPaneData | null>(null);
  const lastValue = useRef("");
  const [sendReason, setSendReason] = useState<string | null>(null);
  const getDestinationHandle = () => {
    const paneId = destination.current;
    const key = boundThreadKey.current;
    return paneId && key ? getPaneComposer(paneId, key) : null;
  };
  const refreshRegion = useRef<() => void>(() => {});
  useEffect(() => {
    let observed: HTMLElement | null = null;
    let frame: number | null = null;
    const mode = new MutationObserver(() => schedule());
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
    const measure = () => {
      frame = null;
      const paneId = destination.current;
      const key = boundThreadKey.current;
      const region = paneId && key ? getPaneComposerEditor(paneId, key) : null;
      if (region !== observed) {
        resize?.disconnect();
        mode.disconnect();
        observed = region;
        if (region) {
          resize?.observe(region);
          mode.observe(region, {
            attributes: true,
            attributeFilter: ["data-composer-input-owner"],
          });
        }
      }
      const stockInput = region?.dataset.composerInputOwner === "stock";
      const wasYielded = yielded.current;
      yielded.current = stockInput;
      if (root.current && key) {
        root.current.hidden = stockInput;
        setCoveredComposerOwner(stockInput ? null : key);
        if (stockInput && root.current.contains(document.activeElement))
          region?.querySelector<HTMLElement>("[contenteditable=true]")?.focus();
        else if (wasYielded && !stockInput && region?.contains(document.activeElement))
          editor.current?.focus();
      }
      const element = surface.current;
      const pane = region?.closest<HTMLElement>("[data-spatial-pane-id]");
      if (!region || !pane || !element) {
        if (element) {
          element.removeAttribute("style");
          delete element.dataset.aligned;
        }
        return;
      }
      const box = region.getBoundingClientRect();
      const parent = pane.getBoundingClientRect();
      if (!parent.width || !parent.height || !box.width || !box.height) return;
      element.dataset.aligned = "true";
      element.style.left = `${(100 * (box.left - parent.left)) / parent.width}%`;
      element.style.top = `${(100 * (box.top - parent.top)) / parent.height}%`;
      element.style.width = `${(100 * box.width) / parent.width}%`;
      element.style.height = `${(100 * box.height) / parent.height}%`;
      element.style.bottom = "auto";
      element.style.right = "auto";
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    refreshRegion.current = schedule;
    const unsubscribe = subscribePaneComposer(schedule);
    schedule();
    return () => {
      unsubscribe();
      resize?.disconnect();
      mode.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      refreshRegion.current = () => {};
    };
  }, []);
  const pending = useRef<{ paneId: string; thread: ThreadPaneData; value: string } | null>(null);
  const flush = useCallback(() => {
    const next = pending.current;
    if (!next) return true;
    if (!editor.current?.bindDraft) return false;
    const threadRef = scopeThreadRef(next.thread.environmentId, next.thread.threadId);
    const bound = editor.current.bindDraft(next.value, Number.POSITIVE_INFINITY, (value) => {
      lastValue.current = value;
      useComposerDraftStore.getState().setPrompt(threadRef, value);
    });
    if (bound) {
      lastValue.current = next.value;
      pending.current = null;
    }
    return bound;
  }, []);
  useEffect(
    () =>
      useComposerDraftStore.subscribe((state) => {
        const key = boundThreadKey.current;
        const thread = boundThread.current;
        const paneId = destination.current;
        if (!key || !thread || !paneId) return;
        const value = state.draftsByThreadKey[key]?.prompt ?? "";
        if (pending.current) {
          pending.current.value = value;
          return;
        }
        if (value === lastValue.current) return;
        pending.current = { paneId, thread, value };
        if (!editor.current?.isComposing?.()) flush();
      }),
    [flush],
  );
  useImperativeHandle(
    ref,
    () => ({
      bind(paneId, thread, focus) {
        if (!root.current || !editor.current?.bindDraft) return false;
        if (
          destination.current === paneId &&
          boundThreadKey.current ===
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.threadId))
        ) {
          setCoveredComposerOwner(
            yielded.current
              ? null
              : scopedThreadKey(scopeThreadRef(thread.environmentId, thread.threadId)),
          );
          if (focus && !yielded.current) editor.current.focus();
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
        boundThread.current = thread;
        setSendReason(null);
        refreshRegion.current();
        setCoveredComposerOwner(scopedThreadKey(threadRef));
        root.current.dataset.composerDestination = paneId;
        yielded.current =
          getPaneComposerEditor(paneId, scopedThreadKey(threadRef))?.dataset.composerInputOwner ===
          "stock";
        root.current.hidden = yielded.current;
        if (yielded.current) {
          setCoveredComposerOwner(null);
          if (focus)
            getPaneComposerEditor(paneId, scopedThreadKey(threadRef))
              ?.querySelector<HTMLElement>("[contenteditable=true]")
              ?.focus();
        } else if (focus) editor.current.focus();
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
        if (!moving) {
          flush();
          refreshRegion.current();
        }
        element.hidden = yielded.current;
        element.style.left = `${frame.x}px`;
        element.style.top = `${frame.y}px`;
        element.style.width = `${frame.width}px`;
        element.style.height = `${frame.height}px`;
        element.dataset.moving = String(moving);
      },
      hide() {
        if (root.current) root.current.hidden = true;
        destination.current = null;
        boundThreadKey.current = null;
        boundThread.current = null;
        pending.current = null;
        setCoveredComposerOwner(null);
      },
    }),
    [flush],
  );
  return (
    <div
      ref={root}
      onCompositionEndCapture={() => queueMicrotask(() => flush())}
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
      <div
        ref={surface}
        className="pointer-events-auto group-data-[moving=true]:pointer-events-none absolute inset-x-3 bottom-3 max-h-[70%] overflow-y-auto rounded-xl border bg-background p-4 shadow-sm data-[aligned=true]:rounded-none data-[aligned=true]:border-0 data-[aligned=true]:p-0 data-[aligned=true]:shadow-none"
      >
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
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length === 0) return;
            event.preventDefault();
            event.stopPropagation();
            const handle = getDestinationHandle();
            if (!handle) {
              setSendReason("Preparing");
              return;
            }
            setSendReason(null);
            handle.addDroppedFiles(files);
          }}
          onCommandKeyDown={(key, event) => key === "Enter" && !event.shiftKey}
        />
      </div>
      {sendReason ? (
        <div role="status" className="absolute inset-x-3 bottom-0 bg-background text-sm">
          {sendReason}
        </div>
      ) : null}
    </div>
  );
}
