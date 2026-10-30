import type { ComposerHandleRef } from "@t3tools/web/src/composerHandleContext";

const panes = new Map<
  string,
  { threadKey: string; ref: ComposerHandleRef; root: { current: HTMLElement | null } | undefined }
>();
const listeners = new Set<() => void>();

export function notifyPaneComposer() {
  for (const listener of listeners) listener();
}

export function subscribePaneComposer(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerPaneComposer(
  paneId: string,
  threadKey: string,
  ref: ComposerHandleRef,
  root?: { current: HTMLElement | null },
) {
  const entry = { threadKey, ref, root };
  panes.set(paneId, entry);
  notifyPaneComposer();
  return () => {
    if (panes.get(paneId) === entry) panes.delete(paneId);
  };
}

export function getPaneComposer(paneId: string, threadKey: string) {
  const entry = panes.get(paneId);
  return entry?.threadKey === threadKey ? entry.ref.current : null;
}

export function getPaneComposerEditor(paneId: string, threadKey: string) {
  const entry = panes.get(paneId);
  return entry?.threadKey === threadKey
    ? (entry.root?.current?.querySelector<HTMLElement>("[data-pane-composer-editor]") ?? null)
    : null;
}
