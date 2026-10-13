import type { DesktopPreviewHostKey, DesktopPreviewHostShortcut } from "@t3tools/contracts";
import {
  isPreviewHostShortcuts,
  matchesPreviewHostShortcut,
} from "@t3tools/shared/previewHostKeyboard";

export function createGuestHostKeyboard(
  document: Document,
  send: (input: DesktopPreviewHostKey) => void,
) {
  let shortcuts: readonly DesktopPreviewHostShortcut[] = [];
  return {
    configure(value: unknown) {
      shortcuts = isPreviewHostShortcuts(value) ? value : [];
    },
    keyDown(event: KeyboardEvent) {
      if (!shortcuts.length || !event.isTrusted || event.defaultPrevented || !document.hasFocus()) {
        return;
      }
      const target = event.composedPath()[0] ?? event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("dialog[open], [role='dialog'][aria-modal='true']")
      ) {
        return;
      }
      const input: DesktopPreviewHostKey = {
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
        isComposing: event.isComposing,
        keyCode: event.keyCode,
        altGraph: event.getModifierState("AltGraph"),
        editing:
          target instanceof HTMLElement &&
          (target.isContentEditable || target.closest("input, textarea, select") !== null),
      };
      if (
        !matchesPreviewHostShortcut(
          input,
          shortcuts,
          document.defaultView?.navigator.platform ?? "",
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      send(input);
    },
  };
}
