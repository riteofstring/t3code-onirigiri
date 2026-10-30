const pendingChanges = new Map<string, () => void>();

export function observePaneVisualChanges(paneId: string, flush: () => void) {
  pendingChanges.set(paneId, flush);
  return () => {
    if (pendingChanges.get(paneId) === flush) pendingChanges.delete(paneId);
  };
}

export function flushPaneVisualChanges(paneId: string) {
  pendingChanges.get(paneId)?.();
}
