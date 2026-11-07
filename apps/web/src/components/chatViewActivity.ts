import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type DependencyList,
  type EffectCallback,
  type ReactNode,
} from "react";

export interface ChatViewActivity {
  readonly isActive: () => boolean;
  readonly isVisible?: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
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

export function useActiveChatViewEffect(effect: EffectCallback, deps: DependencyList): void {
  const activity = useChatViewActivity();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the caller's external subscription only while the host reports the view active
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

export function ActiveChatViewContent({ children }: { children: ReactNode }) {
  const activity = useChatViewActivity();
  const active = useSyncExternalStore(activity.subscribe, activity.isActive, activity.isActive);
  return active ? children : null;
}
