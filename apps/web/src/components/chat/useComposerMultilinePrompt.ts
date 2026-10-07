import { useLayoutEffect, useState } from "react";

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

  // Measure content, not the editor's minimum height. While resting, the
  // prompt is unwrapped: compare its width with the expanded row so that
  // moving the actions inline cannot make collapse and expansion oscillate.
  return bounds.height > lineHeight + 1 || bounds.width > expandedWidth + 1;
}

export function useComposerMultilinePrompt(body: HTMLElement | null): boolean {
  const [isMultiline, setIsMultiline] = useState(false);

  useLayoutEffect(() => {
    if (!body) return;
    let observedEditor: HTMLElement | null = null;
    const measure = () => {
      // The editor element can be replaced, as when a static stand-in gives
      // way to the live editor; follow it so its own size changes are seen.
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
    measure();
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(body, { childList: true, characterData: true, subtree: true });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [body]);

  return isMultiline;
}
