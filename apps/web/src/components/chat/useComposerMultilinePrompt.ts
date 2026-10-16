import { useLayoutEffect, useState } from "react";
import { observeResize } from "../../lib/observeResize";

import { useChatViewActivity } from "../chatViewActivity";

export function measureComposerMultilinePrompt(body: HTMLElement): boolean | null {
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

  // Measure content, not the editor's minimum height. While resting, the
  // prompt is unwrapped: compare its width with the expanded row so that
  // moving the actions inline cannot make collapse and expansion oscillate.
  return bounds.height / scale > lineHeight + 1 || bounds.width / scale > expandedWidth + 1;
}

export function useComposerMultilinePrompt(body: HTMLElement | null): boolean {
  const [isMultiline, setIsMultiline] = useState(false);
  const activity = useChatViewActivity();

  useLayoutEffect(() => {
    if (!body) return;
    let observedEditor = body.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    let stopObserving = () => {};
    const measure = () => {
      // Switching editor modes replaces its element; follow the current one.
      const editor = body.querySelector<HTMLElement>('[data-testid="composer-editor"]');
      if (editor !== observedEditor) {
        stopObserving();
        observedEditor = editor;
        stopObserving = observeResize(editor ? [body, editor] : body, measure);
      }
      const next = measureComposerMultilinePrompt(body);
      if (next !== null) setIsMultiline(next);
    };
    let frame: number | null = null;
    const scheduleMeasure = () => {
      frame ??= requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };
    stopObserving = observeResize(observedEditor ? [body, observedEditor] : body, measure);
    if (activity.isActive()) measure();
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(body, { childList: true, characterData: true, subtree: true });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      stopObserving();
      mutationObserver.disconnect();
    };
  }, [activity, body]);

  return isMultiline;
}
