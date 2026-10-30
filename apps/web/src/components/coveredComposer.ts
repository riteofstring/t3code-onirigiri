import { createContext, useSyncExternalStore } from "react";

export const CoveredComposerContext = createContext(false);
let owner: string | null = null;
const listeners = new Set<() => void>();

export function setCoveredComposerOwner(next: string | null) {
  if (owner === next) return;
  owner = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCoveredComposer(threadKey: string) {
  return useSyncExternalStore(
    subscribe,
    () => owner === threadKey,
    () => false,
  );
}
