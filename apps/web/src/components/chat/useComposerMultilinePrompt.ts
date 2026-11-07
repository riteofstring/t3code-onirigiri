import { useState } from "react";
import { observeResize } from "../../lib/observeResize";

import { useChatViewActivity } from "../chatViewActivity";

function measureComposerMultilinePrompt(body: HTMLElement): boolean | null {
  const editor = body.querySelector<HTMLElement>('[data-testid="composer-editor"]');
  if (!editor || editor.clientWidth === 0) return null;

  const bodyStyle = getComputedStyle(body);
  const expandedWidth =
    body.clientWidth -
    Number.parseFloat(bodyStyle.paddingLeft) -
    Number.parseFloat(bodyStyle.paddingRight);
  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight);
  const range = document.createRange();
  range.selectNodeContents(editor);
  const bounds = range.getBoundingClientRect();
  // Range bounds are on screen, so they include any scale an ancestor
  // transform applies; layout sizes do not.
  const scale = editor.getBoundingClientRect().width / editor.offsetWidth || 1;

  // Measure against expanded width to prevent inline actions oscillating collapse.
  return bounds.height / scale > lineHeight + 1 || bounds.width / scale > expandedWidth + 1;
}

/** Whether the prompt wraps, and the ref callback that measures it on the composer body. */
export function useComposerMultilinePrompt(): readonly [
  boolean,
  (body: HTMLElement | null) => (() => void) | undefined,
] {
  const [isMultiline, setIsMultiline] = useState(false);
  const activity = useChatViewActivity();
  const observeBody = (body: HTMLElement | null) => {
    if (!body) return;
    let observedEditor = body.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    let stopObserving = () => {};
    // Measuring reads layout, so one measurement per frame runs after all of the frame's DOM
    // writes instead of forcing a layout after each mutation.
    let frame: number | null = null;
    const measure = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        // Switching editor modes replaces its element; follow the current one.
        const editor = body.querySelector<HTMLElement>('[data-testid="composer-editor"]');
        if (editor !== observedEditor) {
          stopObserving();
          observedEditor = editor;
          stopObserving = observeResize(editor ? [body, editor] : body, measure);
        }
        const next = measureComposerMultilinePrompt(body);
        if (next !== null) setIsMultiline(next);
      });
    };
    stopObserving = observeResize(observedEditor ? [body, observedEditor] : body, measure);
    // A passive view waits for the observer's first notifications.
    if (activity.isActive()) measure();
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(body, { childList: true, characterData: true, subtree: true });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      stopObserving();
      mutationObserver.disconnect();
    };
  };
  return [isMultiline, observeBody] as const;
}
