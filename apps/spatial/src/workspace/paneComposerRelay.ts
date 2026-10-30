import type { ComposerHandleRef } from "@t3tools/web/src/composerHandleContext";

const panes = new Map<string, { threadKey: string; ref: ComposerHandleRef }>();

export function registerPaneComposer(paneId: string, threadKey: string, ref: ComposerHandleRef) {
  const entry = { threadKey, ref };
  panes.set(paneId, entry);
  return () => {
    if (panes.get(paneId) === entry) panes.delete(paneId);
  };
}

export function getPaneComposer(paneId: string, threadKey: string) {
  const entry = panes.get(paneId);
  return entry?.threadKey === threadKey ? entry.ref.current : null;
}
