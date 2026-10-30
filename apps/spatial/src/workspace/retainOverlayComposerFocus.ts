export function retainOverlayComposerFocus(root: HTMLElement, focus: () => void) {
  let intent: { destination: string | undefined; active: Element | null } | null = null;
  const cancel = () => {
    intent = null;
    observer.disconnect();
  };
  const deliver = () => {
    if (!intent) return;
    if (
      !root.isConnected ||
      root.hidden ||
      root.dataset.composerDestination !== intent.destination ||
      document.activeElement !== intent.active
    ) {
      cancel();
      return;
    }
    if (root.dataset.moving === "true") return;
    cancel();
    focus();
  };
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.attributeName === "data-composer-destination" || record.attributeName === "hidden",
      )
    )
      cancel();
    else deliver();
  });
  const click = (event: MouseEvent) => {
    cancel();
    if (root.hidden || event.button !== 0) return;
    const editor = root.querySelector('[data-testid="composer-editor"]');
    if (!editor) return;
    const box = editor.getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      return;
    intent = { destination: root.dataset.composerDestination, active: document.activeElement };
    observer.observe(root, { attributes: true });
    deliver();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Tab" || event.key === "Escape") cancel();
  };
  window.addEventListener("pointerdown", cancel, true);
  window.addEventListener("click", click);
  window.addEventListener("keydown", key, true);
  window.addEventListener("focusin", cancel, true);
  window.addEventListener("blur", cancel);
  return () => {
    cancel();
    window.removeEventListener("pointerdown", cancel, true);
    window.removeEventListener("click", click);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("focusin", cancel, true);
    window.removeEventListener("blur", cancel);
  };
}
