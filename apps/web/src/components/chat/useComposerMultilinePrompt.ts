import { useLayoutEffect, useState } from "react";

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
    let observedEditor: HTMLElement | null = null;
    const measure = () => {
      // Switching editor modes replaces its element; follow the current one.
      const editor = body.querySelector<HTMLElement>('[data-testid="composer-editor"]');
      if (editor !== observedEditor) {
        if (observedEditor) resizeObserver.unobserve(observedEditor);
        if (editor) resizeObserver.observe(editor);
        observedEditor = editor;
      }
      const next = measureComposerMultilinePrompt(body);
      if (next !== null) setIsMultiline(next);
    };
    // One measurement per frame, still before paint, covers bursts of changes.
    let frame: number | null = null;
    const scheduleMeasure = () => {
      frame ??= requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(body);
    // A passive view waits for the observer's first notification, so a
    // mount does not force a layout of its own.
    if (activity.isActive()) measure();
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(body, { childList: true, characterData: true, subtree: true });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [activity, body]);

  return isMultiline;
}
