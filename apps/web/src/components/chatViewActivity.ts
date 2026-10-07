import {
  createContext,
  useContext,
  useEffect,
  type DependencyList,
  type EffectCallback,
} from "react";

/**
 * Whether a ChatView owns window-wide input. A host that shows several threads
 * at once renders every ChatView live and marks all but the one in use
 * passive: a passive view still renders and updates, but ignores window-level
 * shortcuts, typing, paste and focus requests, never takes focus, and does not
 * mark its thread as visited.
 *
 * Activity is read through a stable object rather than a context value so a
 * host can switch it without re-rendering the ChatView.
 */
export interface ChatViewActivity {
  readonly isActive: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Whether becoming active, or the window regaining focus, moves focus into
   * the composer. A host whose arrow keys navigate between views turns this
   * off; typing still reaches the composer through type-to-focus.
   */
  readonly autofocusComposer?: boolean;
}

const alwaysActive: ChatViewActivity = {
  isActive: () => true,
  subscribe: () => () => {},
};

export const ChatViewActivityContext = createContext<ChatViewActivity>(alwaysActive);

export function useChatViewActivity(): ChatViewActivity {
  return useContext(ChatViewActivityContext);
}

/** Runs `effect` while the ChatView is active and cleans it up when it becomes passive. */
export function useActiveChatViewEffect(effect: EffectCallback, deps: DependencyList): void {
  const activity = useChatViewActivity();
  useEffect(() => {
    let active = false;
    let cleanup: ReturnType<EffectCallback>;
    const sync = () => {
      const next = activity.isActive();
      if (next === active) return;
      active = next;
      if (next) {
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The caller's deps decide when `effect` is recreated.
        cleanup = effect();
      } else {
        cleanup?.();
        cleanup = undefined;
      }
    };
    sync();
    const unsubscribe = activity.subscribe(sync);
    return () => {
      unsubscribe();
      cleanup?.();
    };
  }, [activity, ...deps]);
}
