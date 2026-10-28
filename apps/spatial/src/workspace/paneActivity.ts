import type { ChatViewActivity } from "@t3tools/web/src/components/chatViewActivity";
import { useLayoutEffect, useState, type RefObject } from "react";

function createPaneActivity(initial: boolean, initiallyVisible: boolean, initiallyWarm?: boolean) {
  let active = initial;
  let visible = initiallyVisible;
  let warm = initiallyWarm;
  const listeners = new Set<() => void>();
  const activity: ChatViewActivity & {
    set: (next: boolean, nextVisible: boolean, nextWarm?: boolean) => void;
  } = {
    autofocusComposer: false,
    isActive: () => active,
    isVisible: () => visible,
    ...(initiallyWarm === undefined ? {} : { shouldUpdateContent: () => warm ?? true }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next, nextVisible, nextWarm) => {
      if (next === active && nextVisible === visible && nextWarm === warm) return;
      active = next;
      visible = nextVisible;
      warm = nextWarm;
      for (const listener of listeners) listener();
    },
  };
  return activity;
}

export function usePaneActivity(
  active: boolean,
  visible: boolean,
  root: RefObject<HTMLElement | null>,
  warm?: boolean,
) {
  const [activity] = useState(() => createPaneActivity(active, visible, warm));
  useLayoutEffect(() => {
    activity.set(active, visible, warm);
    const focused = document.activeElement;
    if (!active && focused instanceof HTMLElement) {
      const ownsGuest =
        focused.tagName === "WEBVIEW" &&
        [
          ...(root.current?.querySelectorAll<HTMLElement>("[data-browser-surface-slot]") ?? []),
        ].some((slot) => slot.dataset.browserSurfaceSlot === focused.dataset.previewTab);
      if (ownsGuest || root.current?.contains(focused)) focused.blur();
    }
  }, [active, visible, warm, activity, root]);
  return activity;
}
