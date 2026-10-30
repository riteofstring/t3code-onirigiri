import type { ChatComposerHandle } from "@t3tools/web/src/components/chat/ChatComposer";

export function retainComposerFocusIntent(
  root: HTMLElement,
  composer: () => Pick<ChatComposerHandle, "focusAtEnd"> | null,
) {
  const pane = root.closest<HTMLElement>('[data-onirigiri-slot="pane"]');
  const destination = pane?.dataset.onirigiriPaneId;
  let intent: { editor: HTMLElement; focus: Element | null } | null = null;
  const cancel = () => {
    intent = null;
    observer.disconnect();
  };
  const deliver = () => {
    if (!intent) return;
    const { editor, focus } = intent;
    if (
      !root.isConnected ||
      pane?.dataset.focused !== "true" ||
      pane.dataset.onirigiriPaneId !== destination ||
      root.querySelector('[data-testid="composer-editor"]') !== editor ||
      document.activeElement !== focus
    ) {
      cancel();
      return;
    }
    if (editor.closest('[inert], [hidden], [aria-hidden="true"]')) return;
    const handle = composer();
    if (!handle) return;
    cancel();
    handle.focusAtEnd();
  };
  const observer = new MutationObserver(deliver);
  const click = (event: MouseEvent) => {
    cancel();
    const editor = root.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    if (
      !editor ||
      !editor.closest("[inert]") ||
      pane?.dataset.focused !== "true" ||
      !pane.contains(event.target as Node)
    )
      return;
    const box = editor.getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      return;
    intent = { editor, focus: document.activeElement };
    observer.observe(pane, { attributes: true, childList: true, subtree: true });
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab" || event.key === "Escape") cancel();
  };
  window.addEventListener("pointerdown", cancel, true);
  window.addEventListener("click", click, true);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("focusin", cancel, true);
  window.addEventListener("blur", cancel);
  return () => {
    cancel();
    window.removeEventListener("pointerdown", cancel, true);
    window.removeEventListener("click", click, true);
    window.removeEventListener("keydown", keyDown);
    window.removeEventListener("focusin", cancel, true);
    window.removeEventListener("blur", cancel);
  };
}
