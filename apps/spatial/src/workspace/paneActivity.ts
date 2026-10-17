import type { ChatViewActivity } from "@t3tools/web/src/components/chatViewActivity";
import { useEffect, useState, type RefObject } from "react";

function createPaneActivity(initial: boolean) {
  let active = initial;
  const listeners = new Set<() => void>();
  const activity: ChatViewActivity & { set: (next: boolean) => void } = {
    autofocusComposer: false,
    isActive: () => active,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      if (next === active) return;
      active = next;
      for (const listener of listeners) listener();
    },
  };
  return activity;
}

// A pane that stops being active gives up keyboard focus, so typing and
// workspace navigation reach the active pane rather than this one.
export function usePaneActivity(active: boolean, root: RefObject<HTMLElement | null>) {
  const [activity] = useState(() => createPaneActivity(active));
  useEffect(() => {
    activity.set(active);
    const focused = document.activeElement;
    if (!active && focused instanceof HTMLElement) {
      const ownsGuest =
        focused.tagName === "WEBVIEW" &&
        [
          ...(root.current?.querySelectorAll<HTMLElement>("[data-browser-surface-slot]") ?? []),
        ].some((slot) => slot.dataset.browserSurfaceSlot === focused.dataset.previewTab);
      if (ownsGuest || root.current?.contains(focused)) focused.blur();
    }
  }, [active, activity, root]);
  return activity;
}
