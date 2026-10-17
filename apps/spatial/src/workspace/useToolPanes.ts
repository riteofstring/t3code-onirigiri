import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  readRightPanelSurface,
  terminalSurface,
  type PullRequestSurface,
  type RightPanelSurface,
} from "@t3tools/web/src/rightPanelStore";

import { isPaneTerminalId } from "@t3tools/web/src/terminalOwnership";

const STORAGE_KEY = "onirigiri-t3:tool-panes";
const TOOL_PANE_PREFIX = "tool-";

export type ToolPaneKind = "empty" | "terminal" | "diff" | "surface";

export interface ToolPane {
  readonly paneId: string;
  readonly kind: ToolPaneKind;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId?: string;
  readonly surface?: RightPanelSurface;
}

function isToolPane(value: unknown): value is ToolPane {
  if (typeof value !== "object" || value === null) return false;
  const pane = value as Record<string, unknown>;
  const kindValid =
    pane.kind === "empty" ||
    pane.kind === "diff" ||
    (pane.kind === "surface" && readRightPanelSurface(pane.surface) !== null) ||
    (pane.kind === "terminal" &&
      typeof pane.terminalId === "string" &&
      isPaneTerminalId(pane.terminalId));
  return (
    kindValid &&
    typeof pane.paneId === "string" &&
    pane.paneId.startsWith(TOOL_PANE_PREFIX) &&
    typeof pane.environmentId === "string" &&
    typeof pane.threadId === "string"
  );
}

function readToolPanes(): ToolPane[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    const seen = new Set<string>();
    const pullRequests = new Map<string, PullRequestSurface>();
    return stored.flatMap((pane): ToolPane[] => {
      if (!isToolPane(pane) || seen.has(pane.paneId)) return [];
      seen.add(pane.paneId);
      if (pane.kind !== "surface") return [pane];
      const surface = readRightPanelSurface(pane.surface)!;
      if (surface.kind === "pull-request") {
        const key = JSON.stringify([pane.environmentId, pane.threadId, surface.id]);
        const existing = pullRequests.get(key);
        if (existing) {
          if (!existing.url && surface.url) existing.url = surface.url;
          return [];
        }
        pullRequests.set(key, surface);
      }
      return [{ ...pane, surface }];
    });
  } catch {
    return [];
  }
}

function writeToolPanes(panes: readonly ToolPane[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(panes));
  } catch {}
}

export function newToolResourceId(prefix: string) {
  return `${prefix}${Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(36)).join("-")}`;
}

export function useToolPanes() {
  const [toolPanes, setToolPanes] = useState(readToolPanes);
  const currentRef = useRef(toolPanes);
  const revisions = useRef(new Map<string, number>());
  const getUserActionRevision = useCallback(
    (thread: { environmentId: EnvironmentId; threadId: ThreadId }) =>
      revisions.current.get(JSON.stringify([thread.environmentId, thread.threadId])) ?? 0,
    [],
  );
  const recordUserAction = useCallback(
    (thread: { environmentId: EnvironmentId; threadId: ThreadId }) => {
      const key = JSON.stringify([thread.environmentId, thread.threadId]);
      revisions.current.set(key, (revisions.current.get(key) ?? 0) + 1);
    },
    [],
  );
  useEffect(() => writeToolPanes(toolPanes), [toolPanes]);
  const update = useCallback((change: (panes: readonly ToolPane[]) => ToolPane[]) => {
    const next = change(currentRef.current);
    currentRef.current = next;
    setToolPanes(next);
  }, []);
  const getPanes = useCallback(() => currentRef.current, []);

  const addEmpty = useCallback(
    (thread: { environmentId: EnvironmentId; threadId: ThreadId }, afterPaneId: string | null) => {
      const pane: ToolPane = {
        paneId: newToolResourceId(TOOL_PANE_PREFIX),
        kind: "empty",
        ...thread,
      };
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

  const remove = useCallback(
    (paneId: string) => {
      update((current) => current.filter((pane) => pane.paneId !== paneId));
    },
    [update],
  );

  const openSurface = useCallback(
    (
      thread: { environmentId: EnvironmentId; threadId: ThreadId },
      surface: RightPanelSurface,
      afterPaneId: string | null,
    ) => {
      const current = currentRef.current;
      const belongs = (pane: ToolPane) =>
        pane.environmentId === thread.environmentId && pane.threadId === thread.threadId;
      const existing = current.find((pane) => {
        if (!belongs(pane)) return false;
        const currentSurface = toolPaneSurface(pane);
        return (
          currentSurface?.id === surface.id ||
          (surface.kind === "terminal" &&
            currentSurface?.kind === "terminal" &&
            currentSurface.terminalIds.includes(surface.resourceId))
        );
      });
      const previousSurface = existing && toolPaneSurface(existing);
      if (surface.kind === "terminal" && previousSurface?.kind === "terminal")
        surface = { ...previousSurface, activeTerminalId: surface.activeTerminalId };
      if (
        surface.kind === "pull-request" &&
        previousSurface?.kind === "pull-request" &&
        !surface.url
      )
        surface = previousSurface;
      if (
        surface.kind === "device" &&
        previousSurface?.kind === "device" &&
        previousSurface.title &&
        !surface.title
      )
        surface = { ...surface, title: previousSurface.title };
      const source = current.find((pane) => pane.paneId === afterPaneId && belongs(pane));
      const sourceSurface = source && toolPaneSurface(source);
      const replace =
        source &&
        (source.kind === "empty" ||
          (!existing &&
            ((sourceSurface?.kind === "preview" &&
              sourceSurface.resourceId === null &&
              surface.kind === "preview") ||
              (sourceSurface?.kind === "device" &&
                !sourceSurface.target &&
                surface.kind === "device") ||
              ((sourceSurface?.kind === "files" || sourceSurface?.kind === "file") &&
                surface.kind === "file"))));
      const paneId =
        existing?.paneId ?? (replace ? source.paneId : newToolResourceId(TOOL_PANE_PREFIX));
      const pane: ToolPane = { ...thread, paneId, kind: "surface", surface };
      update((panes) => {
        if (existing || replace)
          return panes.flatMap((entry) =>
            entry.paneId === paneId
              ? [pane]
              : replace && entry.paneId === source.paneId
                ? []
                : [entry],
          );
        const after = panes.findIndex((entry) => entry.paneId === afterPaneId && belongs(entry));
        const first = panes.findIndex(belongs);
        const at = after !== -1 ? after + 1 : first !== -1 ? first : panes.length;
        return [...panes.slice(0, at), pane, ...panes.slice(at)];
      });
      return paneId;
    },
    [update],
  );

  const updateSurface = useCallback(
    (paneId: string, change: (surface: RightPanelSurface) => RightPanelSurface) => {
      update((panes) =>
        panes.map((pane) => {
          const surface = toolPaneSurface(pane);
          return pane.paneId === paneId && surface
            ? { ...pane, kind: "surface", surface: change(surface) }
            : pane;
        }),
      );
    },
    [update],
  );

  const clearSurface = useCallback(
    (paneId: string, surfaceId: string) => {
      update((panes) =>
        panes.map((pane) =>
          pane.paneId === paneId && toolPaneSurface(pane)?.id === surfaceId
            ? {
                paneId,
                kind: "empty",
                environmentId: pane.environmentId,
                threadId: pane.threadId,
              }
            : pane,
        ),
      );
    },
    [update],
  );

  return useMemo(
    () => ({
      toolPanes,
      addEmpty,
      remove,
      getPanes,
      openSurface,
      updateSurface,
      clearSurface,
      getUserActionRevision,
      recordUserAction,
    }),
    [
      toolPanes,
      addEmpty,
      remove,
      getPanes,
      openSurface,
      updateSurface,
      clearSurface,
      getUserActionRevision,
      recordUserAction,
    ],
  );
}

export function toolPaneSurface(pane: ToolPane): RightPanelSurface | null {
  if (pane.kind === "surface") return pane.surface ?? null;
  if (pane.kind === "terminal" && pane.terminalId) return terminalSurface(pane.terminalId);
  if (pane.kind === "diff") return { id: "diff", kind: "diff" };
  return null;
}
