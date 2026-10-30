import type { ChatComposerHandle } from "@t3tools/web/src/components/chat/ChatComposer";

export function retainEarlyComposerInput(
  root: HTMLElement,
  composer: () => Pick<ChatComposerHandle, "insertTextAtEnd" | "focusAtEnd"> | null,
) {
  const pane = root.closest<HTMLElement>('[data-onirigiri-slot="pane"]');
  let intended = false;
  let pending = "";
  const pointerDown = (event: PointerEvent) => {
    observer.disconnect();
    intended = false;
    const editor = root.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    if (!editor || !editor.closest("[inert]") || !pane?.contains(event.target as Node)) return;
    const box = editor.getBoundingClientRect();
    intended =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (intended)
      observer.observe(pane ?? root, {
        attributes: true,
        attributeFilter: ["inert"],
        subtree: true,
      });
  };
  const keyDown = (event: KeyboardEvent) => {
    if (
      !intended ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.isComposing
    )
      return;
    if (event.target !== document.body && event.target !== pane) return;
    if (event.key.length === 1) {
      pending += event.key;
      event.preventDefault();
    } else if (event.key === "Backspace" && pending) {
      pending = Array.from(pending).slice(0, -1).join("");
      event.preventDefault();
    }
  };
  const deliver = () => {
    if (!intended) return;
    const editor = root.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    const handle = composer();
    if (!editor || editor.closest("[inert]") || !handle) return;
    if (pending && !handle.insertTextAtEnd(pending)) return;
    pending = "";
    intended = false;
    observer.disconnect();
    handle.focusAtEnd();
  };
  const observer = new MutationObserver(deliver);
  window.addEventListener("pointerdown", pointerDown, true);
  window.addEventListener("keydown", keyDown, true);
  return () => {
    observer.disconnect();
    window.removeEventListener("pointerdown", pointerDown, true);
    window.removeEventListener("keydown", keyDown, true);
  };
}
