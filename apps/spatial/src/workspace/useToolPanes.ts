import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback, useState } from "react";

const STORAGE_KEY = "onirigiri-t3:tool-panes";

export type ToolPaneKind = "empty" | "terminal" | "diff";

/**
 * A pane the user added beside a thread: empty until they pick what it shows,
 * or one of the thread's terminals or its diff. It follows its thread's pane.
 */
export interface ToolPane {
  readonly paneId: string;
  readonly kind: ToolPaneKind;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId?: string;
}

function readToolPanes(): ToolPane[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? (stored as ToolPane[]) : [];
  } catch {
    return [];
  }
}

function writeToolPanes(panes: readonly ToolPane[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(panes));
  } catch {
    // Unavailable storage only loses the added panes across reloads.
  }
}

let created = 0;
function newId(prefix: string) {
  created += 1;
  return `${prefix}-${Date.now().toString(36)}-${created}`;
}

/** The panes the user added, in order, remembered across reloads. */
export function useToolPanes() {
  const [toolPanes, setToolPanes] = useState(readToolPanes);
  const update = useCallback((change: (panes: readonly ToolPane[]) => ToolPane[]) => {
    setToolPanes((current) => {
      const next = change(current);
      writeToolPanes(next);
      return next;
    });
  }, []);

  /**
   * Adds an empty pane for `thread`: right after `afterPaneId` when that is
   * one of its added panes, otherwise right after the thread's own pane.
   */
  const addEmpty = useCallback(
    (thread: { environmentId: EnvironmentId; threadId: ThreadId }, afterPaneId: string | null) => {
      const pane: ToolPane = { paneId: newId("tool"), kind: "empty", ...thread };
      update((current) => {
        const after = current.findIndex((existing) => existing.paneId === afterPaneId);
        const first = current.findIndex(
          (existing) =>
            existing.environmentId === thread.environmentId &&
            existing.threadId === thread.threadId,
        );
        const at = after !== -1 ? after + 1 : first !== -1 ? first : current.length;
        return [...current.slice(0, at), pane, ...current.slice(at)];
      });
      return pane.paneId;
    },
    [update],
  );

  /** Turns an empty pane into a terminal or the thread's diff. */
  const choose = useCallback(
    (paneId: string, kind: "terminal" | "diff") => {
      update((current) =>
        current.map((pane) =>
          pane.paneId === paneId
            ? { ...pane, kind, ...(kind === "terminal" ? { terminalId: newId("spatial") } : {}) }
            : pane,
        ),
      );
    },
    [update],
  );

  const remove = useCallback(
    (paneId: string) => {
      update((current) => current.filter((pane) => pane.paneId !== paneId));
    },
    [update],
  );

  return { toolPanes, addEmpty, choose, remove };
}
