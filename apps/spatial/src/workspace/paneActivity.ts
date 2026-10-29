import type { ChatViewActivity } from "@t3tools/web/src/components/chatViewActivity";
import { useEffect, useState, type RefObject } from "react";

function createPaneActivity(initial: boolean, initiallyVisible: boolean) {
  let active = initial;
  let visible = initiallyVisible;
  const listeners = new Set<() => void>();
  const activity: ChatViewActivity & { set: (next: boolean, nextVisible: boolean) => void } = {
    autofocusComposer: false,
    isActive: () => active,
    isVisible: () => visible,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next, nextVisible) => {
      if (next === active && nextVisible === visible) return;
      active = next;
      visible = nextVisible;
      for (const listener of listeners) listener();
    },
  };
  return activity;
}

export function usePaneActivity(
  active: boolean,
  visible: boolean,
  root: RefObject<HTMLElement | null>,
) {
  const [activity] = useState(() => createPaneActivity(active, visible));
  useEffect(() => {
    activity.set(active, visible);
    const focused = document.activeElement;
    if (!active && focused instanceof HTMLElement) {
      const ownsGuest =
        focused.tagName === "WEBVIEW" &&
        [
          ...(root.current?.querySelectorAll<HTMLElement>("[data-browser-surface-slot]") ?? []),
        ].some((slot) => slot.dataset.browserSurfaceSlot === focused.dataset.previewTab);
      if (ownsGuest || root.current?.contains(focused)) focused.blur();
    }
  }, [active, visible, activity, root]);
  return activity;
}
