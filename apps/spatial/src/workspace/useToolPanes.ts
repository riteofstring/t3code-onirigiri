import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";

import { PANE_TERMINAL_ID_PREFIX } from "@t3tools/web/src/terminalOwnership";

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

function isToolPane(value: unknown): value is ToolPane {
  if (typeof value !== "object" || value === null) return false;
  const pane = value as Record<string, unknown>;
  const kindValid =
    pane.kind === "empty" ||
    pane.kind === "diff" ||
    (pane.kind === "terminal" && typeof pane.terminalId === "string");
  return (
    kindValid &&
    typeof pane.paneId === "string" &&
    typeof pane.environmentId === "string" &&
    typeof pane.threadId === "string"
  );
}

// Stored records that are malformed or repeat a pane are dropped.
function readToolPanes(): ToolPane[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    const seen = new Set<string>();
    return stored.filter((pane): pane is ToolPane => {
      if (!isToolPane(pane) || seen.has(pane.paneId)) return false;
      seen.add(pane.paneId);
      return true;
    });
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
  return `${prefix}${Date.now().toString(36)}-${created}`;
}

/** The panes the user added, in order, remembered across reloads. */
export function useToolPanes() {
  const [toolPanes, setToolPanes] = useState(readToolPanes);
  useEffect(() => writeToolPanes(toolPanes), [toolPanes]);
  const update = useCallback((change: (panes: readonly ToolPane[]) => ToolPane[]) => {
    setToolPanes((current) => change(current));
  }, []);

  /**
   * Adds an empty pane for `thread`: right after `afterPaneId` when that is
   * one of its added panes, otherwise right after the thread's own pane.
   */
  const addEmpty = useCallback(
    (thread: { environmentId: EnvironmentId; threadId: ThreadId }, afterPaneId: string | null) => {
      const pane: ToolPane = { paneId: newId("tool-"), kind: "empty", ...thread };
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
      const terminalId = kind === "terminal" ? newId(PANE_TERMINAL_ID_PREFIX) : undefined;
      update((current) =>
        current.map((pane) =>
          pane.paneId === paneId ? { ...pane, kind, ...(terminalId ? { terminalId } : {}) } : pane,
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
