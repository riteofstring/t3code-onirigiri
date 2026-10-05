import {
  OnirigiriWorkspace,
  type OnirigiriPaneDefinition,
  type OnirigiriWorkspaceHandle,
  type WorkspaceFocusedPaneFrame,
  type WorkspacePane,
} from "@riteofstring/onirigiri";
import "@riteofstring/onirigiri/styles.css";
import { reconcileWorkspaceLayout } from "@riteofstring/onirigiri-t3";
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
    const projectById = new Map(
      projects.map((project) => [scopedKey(project.environmentId, project.id), project]),
    );
    const threadById = new Map(
      threads.map((thread) => [scopedKey(thread.environmentId, thread.id), thread]),
    );
    const layout = reconcileWorkspaceLayout(
      { rows: [] },
      {
        projects: [...projectById.keys()].map((id) => ({ id })),
        threads: threads
          .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((thread) => ({
            id: scopedKey(thread.environmentId, thread.id),
            projectId: scopedKey(thread.environmentId, thread.projectId),
            archived: thread.archivedAt !== null,
          })),
      },
    );
    const panes = layout.rows
      .filter((row) => row.panes.length > 0)
      .slice(0, MAX_ROWS)
      .flatMap((row, planeIndex) =>
        row.panes.slice(0, MAX_THREADS_PER_ROW).flatMap((pane, slotIndex) => {
          const thread = threadById.get(pane.threadId);
          if (!thread) return [];
          return [
            {
              paneId: threadPaneId(thread.environmentId, thread.id),
              planeIndex,
              slotIndex,
              surfaceKind: "thread",
              title: thread.title,
              subtitle: projectById.get(row.projectId)?.title ?? "",
              data: {
                environmentId: thread.environmentId,
                threadId: thread.id,
              } satisfies ThreadPaneData,
            },
          ];
        }),
      );
    return panes.length > 0 ? panes : null;
  }, [bootstrapped, projects, threads]);
}

function scopedKey(environmentId: string, id: string) {
  return `${environmentId}:${id}`;
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

interface PaneContentInsets {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

// Places the shared ChatView over the focused pane's content area from the
// frames Onirigiri reports, so following the camera never reads layout.
class OverlayPlacement {
  private frame: WorkspaceFocusedPaneFrame | null = null;
  private insets: PaneContentInsets | null = null;
  private stageOrigin = { x: 0, y: 0 };
  private written = "";

  constructor(private readonly overlay: { readonly current: HTMLDivElement | null }) {}

  setSlot(slot: HTMLElement | null) {
    const host = slot?.closest<HTMLElement>("[data-onirigiri-pane-id]");
    const stage = slot?.closest<HTMLElement>('[data-onirigiri-slot="stage"]');
    if (slot && host && stage && !this.insets) {
      const hostRect = host.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const scale = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1;
      this.insets = {
        bottom: (hostRect.bottom - slotRect.bottom) / scale,
        left: (slotRect.left - hostRect.left) / scale,
        right: (hostRect.right - slotRect.right) / scale,
        top: (slotRect.top - hostRect.top) / scale,
      };
      this.stageOrigin = { x: stageRect.left, y: stageRect.top };
    }
    this.apply();
  }

  setFrame(frame: WorkspaceFocusedPaneFrame | null) {
    this.frame = frame;
    this.apply();
  }

  private apply() {
    const overlay = this.overlay.current;
    if (!overlay) return;
    const { frame, insets } = this;
    if (!frame || !insets || Math.abs(frame.scale - 1) > 0.001) {
      if (this.written !== "hidden") {
        this.written = "hidden";
        overlay.style.visibility = "hidden";
      }
      return;
    }
    const x = this.stageOrigin.x + frame.x + insets.left;
    const y = this.stageOrigin.y + frame.y + insets.top;
    const width = frame.width - insets.left - insets.right;
    const height = frame.height - insets.top - insets.bottom;
    const next = `${x},${y},${width},${height}`;
    if (next === this.written) return;
    this.written = next;
    overlay.style.transform = `translate(${x}px, ${y}px)`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
    overlay.style.visibility = "visible";
  }
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
  const [placement] = useState(() => new OverlayPlacement(overlayRef));

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

  useLayoutEffect(() => {
    if (mode === "overlay") placement.setSlot(slot?.element ?? null);
  }, [mode, placement, slot]);

  useEffect(() => {
    if (!slot || slot.paneId === routePaneId) return;
    const data = paneData.get(slot.paneId);
    if (!data) return;
    // Switch the thread after the focus change has painted, so ChatView's
    // layout reads do not also lay out the workspace's pending changes.
    let timeout = 0;
    const frame = requestAnimationFrame(() => {
      timeout = window.setTimeout(() => {
        void navigate({ to: "/$environmentId/$threadId", params: data });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
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
          onFocusedPaneFrame={(frame) => placement.setFrame(frame)}
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
