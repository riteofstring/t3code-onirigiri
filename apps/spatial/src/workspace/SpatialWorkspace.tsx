import {
  OnirigiriWorkspace,
  type OnirigiriPaneDefinition,
  type OnirigiriWorkspaceHandle,
  type WorkspacePane,
} from "@riteofstring/onirigiri";
import "@riteofstring/onirigiri/styles.css";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { ThreadRouteView } from "@t3tools/web/src/components/ThreadRouteView";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "@t3tools/web/src/state/entities";
import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

type ChatHostMode = "none" | "overlay" | "reparent";

interface ThreadPaneData {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

interface FocusedSlot {
  readonly paneId: string;
  readonly element: HTMLElement;
}

const MAX_ROWS = 3;
const MAX_THREADS_PER_ROW = 4;

function threadPaneId(environmentId: string, threadId: string) {
  return `thread:${environmentId}:${threadId}`;
}

function readChatHostMode(): ChatHostMode {
  const mode = new URLSearchParams(window.location.search).get("chat");
  return mode === "reparent" || mode === "none" ? mode : "overlay";
}

function useThreadPanes(): readonly OnirigiriPaneDefinition[] | null {
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const projects = useProjects();
  const threads = useThreadShells();

  return useMemo(() => {
    if (!bootstrapped) return null;
    const rows = projects
      .map((project) => ({
        project,
        threads: threads
          .filter(
            (thread) =>
              thread.environmentId === project.environmentId &&
              thread.projectId === project.id &&
              thread.archivedAt === null,
          )
          .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, MAX_THREADS_PER_ROW),
      }))
      .filter((row) => row.threads.length > 0)
      .slice(0, MAX_ROWS);
    const panes = rows.flatMap((row, planeIndex) =>
      row.threads.map((thread, slotIndex) => ({
        paneId: threadPaneId(thread.environmentId, thread.id),
        planeIndex,
        slotIndex,
        surfaceKind: "thread",
        title: thread.title,
        subtitle: row.project.title,
        data: { environmentId: thread.environmentId, threadId: thread.id } satisfies ThreadPaneData,
      })),
    );
    return panes.length > 0 ? panes : null;
  }, [bootstrapped, projects, threads]);
}

function FocusedPaneSlot({
  paneId,
  onSlot,
}: {
  paneId: string;
  onSlot: (update: (current: FocusedSlot | null) => FocusedSlot | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const slot = { paneId, element: ref.current };
    onSlot(() => slot);
    return () => onSlot((current) => (current === slot ? null : current));
  }, [onSlot, paneId]);
  return <div ref={ref} className="spatial-chat-slot" data-spatial-chat-slot={paneId} />;
}

function UnfocusedThreadPane({ pane }: { pane: WorkspacePane }) {
  return (
    <div className="flex h-full flex-col justify-center gap-1 bg-background p-6 text-foreground">
      <div className="text-sm text-muted-foreground">{pane.subtitle}</div>
      <div className="text-lg font-medium">{pane.title}</div>
    </div>
  );
}

function useOverlayFollowsSlot(
  overlayRef: { readonly current: HTMLDivElement | null },
  enabled: boolean,
  slot: FocusedSlot | null,
) {
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (!enabled || !slot) {
      overlay.style.visibility = "hidden";
      return;
    }
    let frame = 0;
    let last = "";
    const follow = () => {
      const rect = slot.element.getBoundingClientRect();
      const scaled = Math.abs(rect.width - slot.element.offsetWidth) > 0.5;
      const next = scaled ? "scaled" : `${rect.left},${rect.top},${rect.width},${rect.height}`;
      if (next !== last && scaled) {
        last = next;
        overlay.style.visibility = "hidden";
      } else if (next !== last) {
        last = next;
        overlay.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        overlay.style.visibility = "visible";
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [enabled, overlayRef, slot]);
}

export function SpatialWorkspace({ target }: { target: ThreadRouteTarget | null }) {
  const navigate = useNavigate();
  const threadPanes = useThreadPanes();
  const [initialPanes, setInitialPanes] = useState(threadPanes);
  if (initialPanes === null && threadPanes !== null) setInitialPanes(threadPanes);
  const workspaceRef = useRef<OnirigiriWorkspaceHandle>(null);
  const [mode] = useState(readChatHostMode);
  const [slot, setSlot] = useState<FocusedSlot | null>(null);
  const [chatHost] = useState(() => {
    const element = document.createElement("div");
    element.className = "spatial-chat-host";
    return element;
  });
  const overlayRef = useRef<HTMLDivElement>(null);
  const [overview, setOverview] = useState(false);

  const paneData = useMemo(() => {
    const byPaneId = new Map<string, ThreadPaneData>();
    for (const pane of initialPanes ?? []) byPaneId.set(pane.paneId, pane.data as ThreadPaneData);
    return byPaneId;
  }, [initialPanes]);

  const routePaneId =
    target?.kind === "server"
      ? threadPaneId(target.threadRef.environmentId, target.threadRef.threadId)
      : null;

  useLayoutEffect(() => {
    if (mode !== "reparent") return;
    if (slot) slot.element.appendChild(chatHost);
    else chatHost.remove();
  }, [chatHost, mode, slot]);

  useOverlayFollowsSlot(overlayRef, mode === "overlay" && !overview, overview ? null : slot);

  useEffect(() => {
    if (!slot || slot.paneId === routePaneId) return;
    const data = paneData.get(slot.paneId);
    if (!data) return;
    void navigate({ to: "/$environmentId/$threadId", params: data });
  }, [navigate, paneData, routePaneId, slot]);

  const focusRoutePane = useEffectEvent((paneId: string) => {
    if (paneData.has(paneId) && slot?.paneId !== paneId) workspaceRef.current?.focusPane(paneId);
  });

  useEffect(() => {
    if (routePaneId) focusRoutePane(routePaneId);
  }, [routePaneId]);

  const renderPane = useCallback(
    (pane: WorkspacePane, state: { focused: boolean }) =>
      state.focused ? (
        <FocusedPaneSlot paneId={pane.paneId} onSlot={setSlot} />
      ) : (
        <UnfocusedThreadPane pane={pane} />
      ),
    [],
  );

  const chatView = target && mode !== "none" ? <ThreadRouteView target={target} /> : null;

  return (
    <div className="spatial-workspace h-dvh w-full" data-spatial-chat-mode={mode}>
      {initialPanes ? (
        <OnirigiriWorkspace
          ref={workspaceRef}
          ariaLabel="Onirigiri for T3 Code"
          initialPanes={initialPanes}
          renderPane={renderPane}
          shortcutScope="application"
          onPresentationModeChange={(next) => setOverview(next === "overview")}
          workspaceId="onirigiri-t3-spike"
        />
      ) : null}
      {mode === "reparent" ? (
        createPortal(chatView, chatHost)
      ) : (
        <div ref={overlayRef} className="spatial-chat-overlay spatial-chat-host">
          {chatView}
        </div>
      )}
    </div>
  );
}
