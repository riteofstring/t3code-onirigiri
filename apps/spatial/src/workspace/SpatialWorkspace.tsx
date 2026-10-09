import {
  OnirigiriWorkspace,
  createWorkspaceScene,
  defaultOnirigiriShortcuts,
  type OnirigiriShortcutBindings,
  serializeWorkspaceLayout,
  type OnirigiriLayout,
  type OnirigiriPaneDefinition,
  type OnirigiriPaneRenderState,
  type OnirigiriWorkspaceHandle,
  type WorkspaceFocusedPaneFrame,
  type WorkspacePane,
  type WorkspaceScene,
} from "@riteofstring/onirigiri";
import "@riteofstring/onirigiri/styles.css";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { terminalEnvironment } from "@t3tools/web/src/state/terminal";
import { useAtomCommand } from "@t3tools/web/src/state/use-atom-command";
import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { EmptyPane } from "./EmptyPane";
import { AddPaneButton, FocusAnchorToggle, useFocusAnchorPreference } from "./FocusAnchorToggle";
import { PaneLifecycleContext, createPaneLifecycleStore, type PanePosition } from "./paneLifecycle";
import { DiffPane, TerminalPane } from "./SidePanes";
import { SavedPanePicture } from "./SavedPanePicture";
import { ThreadCard } from "./ThreadCard";
import { SpatialWorkspaceActiveContext, ThreadPane } from "./ThreadPane";
import { useToolPanes, type ToolPane } from "./useToolPanes";
import { PaneSnapshotContext, useSavedPanePictures } from "./useSavedPanePictures";
import {
  threadPaneId,
  useWorkspacePanes,
  type ThreadPaneData,
  type WorkspaceLayoutMode,
} from "./useWorkspacePanes";

const WORKSPACE_ID = "onirigiri-t3";

// A thread's composer usually holds focus, so moving between panes and
// overview also answer to Control+Alt chords, which never edit text.
function whileEditing(key: string) {
  return { altKey: true, ctrlKey: true, key, metaKey: false, shiftKey: false, whileEditing: true };
}
// Panes are threads and their side panes, which the workspace places itself,
// so only navigation shortcuts apply; splitting or moving panes does not.
const NAVIGATION = new Set([
  "focusDown",
  "focusFirstColumn",
  "focusLastColumn",
  "focusLeft",
  "focusRight",
  "focusUp",
  "returnHome",
  "toggleOverview",
]);
const SHORTCUTS: OnirigiriShortcutBindings = {
  ...Object.fromEntries(
    Object.keys(defaultOnirigiriShortcuts)
      .filter((action) => !NAVIGATION.has(action))
      .map((action) => [action, []]),
  ),
  focusDown: [...defaultOnirigiriShortcuts.focusDown, whileEditing("ArrowDown")],
  focusLeft: [...defaultOnirigiriShortcuts.focusLeft, whileEditing("ArrowLeft")],
  focusRight: [...defaultOnirigiriShortcuts.focusRight, whileEditing("ArrowRight")],
  focusUp: [...defaultOnirigiriShortcuts.focusUp, whileEditing("ArrowUp")],
  toggleOverview: [...defaultOnirigiriShortcuts.toggleOverview, whileEditing("o")],
};
/** Quiet time after a focus change before the app route follows it. */
const ROUTE_SETTLE_MS = 450;

function readWorkspaceOptions() {
  const search = new URLSearchParams(window.location.search);
  return {
    layout: (search.get("layout") === "strip" ? "strip" : "rows") as WorkspaceLayoutMode,
  };
}

function threadPanePositions(panes: readonly OnirigiriPaneDefinition[]): PanePosition[] {
  return panes
    .filter((pane) => pane.surfaceKind === "thread")
    .map((pane) => ({
      paneId: pane.paneId,
      plane: pane.planeIndex ?? 0,
      slot: pane.slotIndex ?? 0,
    }));
}

// Panes that stay keep the widths their columns were given.
function keepColumnWidths(layout: OnirigiriLayout, current: WorkspaceScene): OnirigiriLayout {
  const columnByPane = new Map(
    current.columns.flatMap((column) => column.cells.map((cell) => [cell.paneId, column] as const)),
  );
  return {
    ...layout,
    columns: layout.columns.map((column) => {
      const previous = column.cells
        .map((cell) => columnByPane.get(cell.paneId))
        .find((match) => match !== undefined);
      if (!previous) return column;
      const { widthOverride, previousProportionWidth } = previous;
      return {
        ...column,
        idealWidthSpec: previous.idealWidthSpec,
        widthSpec: previous.widthSpec,
        ...(widthOverride === undefined ? {} : { widthOverride }),
        ...(previousProportionWidth === undefined ? {} : { previousProportionWidth }),
      };
    }),
  };
}

function paneMembership(panes: readonly OnirigiriPaneDefinition[]) {
  return panes.map((pane) => `${pane.paneId}@${pane.planeIndex}:${pane.slotIndex}`).join("|");
}

export function SpatialWorkspace({
  target,
  active,
}: {
  target: ThreadRouteTarget | null;
  /** False while a draft or another route covers the workspace. */
  active: boolean;
}) {
  const router = useRouter();
  const [{ layout: layoutMode }] = useState(readWorkspaceOptions);
  const { toolPanes, addEmpty, choose, remove } = useToolPanes();
  const toolPanesRef = useRef(toolPanes);
  useEffect(() => {
    toolPanesRef.current = toolPanes;
  }, [toolPanes]);
  const panes = useWorkspacePanes(layoutMode, toolPanes);
  const [initialPanes, setInitialPanes] = useState(panes);
  if (initialPanes === null && panes !== null) setInitialPanes(panes);
  const workspaceRef = useRef<OnirigiriWorkspaceHandle>(null);
  const [focusAnchor, toggleFocusAnchor] = useFocusAnchorPreference();
  const [controlsContainer, setControlsContainer] = useState<HTMLDivElement | null>(null);
  const getLayout = useCallback(() => workspaceRef.current?.getLayout() ?? null, []);
  const {
    getPanePicture,
    onLayoutChange,
    onPanePictureCaptured,
    pictureFor,
    preparedPictureUrl,
    pictureUrl,
    hasFreshPicture,
    canBackgroundPicture,
    picturesLoaded,
    requestSnapshot,
    stageRef,
  } = useSavedPanePictures(getLayout);
  // Focus is kept out of React state so moving between panes does not
  // re-render the workspace.
  const focusedPaneIdRef = useRef<string | null>(null);
  // A pane just added, focused once the arrangement includes it.
  const pendingFocusPaneIdRef = useRef<string | null>(null);

  const paneData = useMemo(() => {
    const byPaneId = new Map<string, ThreadPaneData>();
    for (const pane of panes ?? []) {
      if (pane.surfaceKind === "thread") byPaneId.set(pane.paneId, pane.data as ThreadPaneData);
    }
    return byPaneId;
  }, [panes]);
  const panesRef = useRef(panes);
  const activeRef = useRef(active);

  const routePaneId =
    target?.kind === "server"
      ? threadPaneId(target.threadRef.environmentId, target.threadRef.threadId)
      : null;

  const [lifecycle, setLifecycle] = useState<ReturnType<typeof createPaneLifecycleStore> | null>(
    null,
  );
  if (lifecycle === null && initialPanes !== null) {
    setLifecycle(createPaneLifecycleStore(threadPanePositions(initialPanes), routePaneId));
  }

  // Panes appearing, leaving or moving rebuild the arrangement around the
  // focused pane; renames and an empty pane's choice change panes in place.
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!panes || !workspace) return;
    const previous = panesRef.current;
    panesRef.current = panes;
    if (!previous || previous === panes) return;
    if (paneMembership(panes) !== paneMembership(previous)) {
      const { scene } = createWorkspaceScene({
        gridAxes: layoutMode === "strip" ? "horizontal" : "spatial",
        id: WORKSPACE_ID,
        panes,
      });
      const focused =
        panes.find((pane) => pane.paneId === pendingFocusPaneIdRef.current) ??
        panes.find((pane) => pane.paneId === focusedPaneIdRef.current) ??
        panes.find((pane) => pane.surfaceKind === "thread");
      const added = panes.some((pane) => pane.paneId === pendingFocusPaneIdRef.current)
        ? pendingFocusPaneIdRef.current
        : null;
      pendingFocusPaneIdRef.current = null;
      const layout = serializeWorkspaceLayout(scene, {
        column: focused?.slotIndex ?? 0,
        row: focused?.planeIndex ?? 0,
        split: 0,
      });
      workspace.restoreLayout(keepColumnWidths(layout, workspace.getScene()), {
        keepPresentation: true,
      });
      // A pane just added is for using now: leave overview to show it.
      if (added && workspace.getSnapshot().presentationMode === "overview") {
        workspace.focusPane(added, { exitOverview: true });
      }
      return;
    }
    const previousById = new Map(previous.map((pane) => [pane.paneId, pane]));
    for (const pane of panes) {
      const before = previousById.get(pane.paneId);
      // An empty pane the user turned into a terminal or diff changes in place.
      if (before && before.surfaceKind !== pane.surfaceKind) {
        workspace.configurePane(pane.paneId, {
          data: pane.data,
          surfaceKind: pane.surfaceKind,
          title: pane.title,
        });
      } else if (pane.title && before?.title !== pane.title) {
        workspace.renamePane(pane.paneId, pane.title);
      }
    }
  }, [layoutMode, panes]);

  useEffect(() => () => lifecycle?.dispose(), [lifecycle]);
  useEffect(() => {
    lifecycle?.setPictures(hasFreshPicture, picturesLoaded, canBackgroundPicture);
  }, [hasFreshPicture, lifecycle, picturesLoaded, canBackgroundPicture]);
  // Preparation and snapshot drawing explicitly lay out offscreen content.
  // Covered workspaces have no measurable viewport and must not start captures.
  useEffect(() => {
    lifecycle?.setBackgroundPictures(active);
  }, [active, lifecycle]);
  useEffect(() => {
    if (panes && lifecycle) {
      lifecycle.setPanes(threadPanePositions(panes));
    }
  }, [lifecycle, panes]);

  // The app route follows the focused thread once the camera rests, so T3's
  // global surfaces act on it. Routes this workspace requested are remembered
  // so they are not mistaken for a navigation elsewhere in the app, which
  // instead moves focus to its pane.
  const requestedRoutesRef = useRef(new Set<string>());
  const routeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRouteRef = useRef<(() => void) | null>(null);
  const routePaneIdRef = useRef(routePaneId);
  // A route change made elsewhere, or covering the workspace, supersedes a
  // pending follow of the camera; one this workspace asked for earlier does not.
  useEffect(() => {
    const coveredChanged = activeRef.current !== active;
    routePaneIdRef.current = routePaneId;
    activeRef.current = active;
    const requested = routePaneId !== null && requestedRoutesRef.current.has(routePaneId);
    if (!coveredChanged && requested) return;
    if (routeTimerRef.current !== null) {
      clearTimeout(routeTimerRef.current);
      routeTimerRef.current = null;
    }
    pendingRouteRef.current = null;
  }, [routePaneId, active]);
  useEffect(
    () => () => {
      if (routeTimerRef.current !== null) clearTimeout(routeTimerRef.current);
    },
    [],
  );

  const onFocusedPaneFrame = useCallback(
    (frame: WorkspaceFocusedPaneFrame | null) => {
      if (!frame || frame.paneId === focusedPaneIdRef.current || !activeRef.current) return;
      const paneId = frame.paneId;
      focusedPaneIdRef.current = paneId;
      // A terminal or diff pane acts for its thread, which the route follows.
      const tool = toolPanesRef.current.find((pane) => pane.paneId === paneId);
      const routeTarget = tool ? threadPaneId(tool.environmentId, tool.threadId) : paneId;
      const data = paneData.get(routeTarget);
      if (!data) return;
      if (!tool) lifecycle?.setFocus(paneId);
      if (routeTimerRef.current !== null) clearTimeout(routeTimerRef.current);
      const follow = () => {
        if (routeTimerRef.current !== null) clearTimeout(routeTimerRef.current);
        routeTimerRef.current = null;
        pendingRouteRef.current = null;
        if (routeTarget === routePaneIdRef.current || focusedPaneIdRef.current !== paneId) return;
        requestedRoutesRef.current.add(routeTarget);
        void router.navigate({ to: "/$environmentId/$threadId", params: data });
      };
      pendingRouteRef.current = follow;
      routeTimerRef.current = setTimeout(follow, ROUTE_SETTLE_MS);
    },
    [lifecycle, paneData, router],
  );

  // Anything but moving on through the workspace, such as opening the command
  // palette or clicking, may act on the focused thread, so a route still
  // waiting for the camera follows it at once.
  useEffect(() => {
    const followNow = (event: Event) => {
      const follow = pendingRouteRef.current;
      if (!follow) return;
      if (event instanceof KeyboardEvent) {
        const modifierOnly = ["Alt", "Control", "Meta", "Shift"].includes(event.key);
        const navigating = event.altKey && (event.key.startsWith("Arrow") || event.code === "KeyO");
        if (modifierOnly || navigating) return;
      }
      follow();
    };
    window.addEventListener("keydown", followNow, true);
    window.addEventListener("pointerdown", followNow, true);
    return () => {
      window.removeEventListener("keydown", followNow, true);
      window.removeEventListener("pointerdown", followNow, true);
    };
  }, []);

  // Focus moved while the workspace was covered, as when a route it did not
  // request focused a pane, reaches the lifecycle once it shows again.
  useEffect(() => {
    if (!active || !lifecycle) return;
    const paneId = workspaceRef.current?.getSnapshot().focusedPaneId;
    if (paneId && paneId !== focusedPaneIdRef.current && paneData.has(paneId)) {
      focusedPaneIdRef.current = paneId;
      lifecycle.setFocus(paneId);
    }
  }, [active, lifecycle, paneData]);

  // A route the workspace did not request (the sidebar, a notification, a new
  // thread) moves focus to its pane, leaving overview. A thread whose pane is
  // not in the workspace yet is focused once reconciliation adds it.
  const pendingRoutePaneRef = useRef<string | null>(null);
  const focusRoutePane = useEffectEvent((paneId: string) => {
    if (requestedRoutesRef.current.delete(paneId)) return;
    if (!paneData.has(paneId)) {
      pendingRoutePaneRef.current = paneId;
      return;
    }
    pendingRoutePaneRef.current = null;
    workspaceRef.current?.focusPane(paneId, { exitOverview: true });
  });

  useEffect(() => {
    if (routePaneId) focusRoutePane(routePaneId);
  }, [routePaneId]);

  // Selecting the thread the route already shows changes no route, but still
  // asks for its pane: in overview, or while the camera rests elsewhere.
  useEffect(
    () =>
      router.subscribe("onBeforeNavigate", (event) => {
        if (event.hrefChanged) return;
        const match = router
          .matchRoutes(event.toLocation)
          .find((routeMatch) => routeMatch.routeId === "/_chat/$environmentId/$threadId");
        const params = match?.params as { environmentId?: string; threadId?: string } | undefined;
        if (params?.environmentId && params.threadId) {
          focusRoutePane(threadPaneId(params.environmentId, params.threadId));
        }
      }),
    [router],
  );

  useEffect(() => {
    const pending = pendingRoutePaneRef.current;
    if (pending && paneData.has(pending)) focusRoutePane(pending);
  }, [paneData]);

  const navigateAway = useCallback(
    (href: string) => {
      void router.navigate({ href });
    },
    [router],
  );

  // A new empty pane opens beside the focused pane, for its thread.
  const addPane = useCallback(() => {
    const focused = focusedPaneIdRef.current;
    const thread = focused ? paneData.get(focused) : undefined;
    const tool = toolPanes.find((pane) => pane.paneId === focused);
    const owner = thread ?? tool;
    if (!owner) return;
    pendingFocusPaneIdRef.current = addEmpty(
      { environmentId: owner.environmentId, threadId: owner.threadId },
      tool?.paneId ?? null,
    );
  }, [addEmpty, paneData, toolPanes]);

  // Terminals consume the keys they receive, so the Control+Option moves
  // that work while typing are taken before a terminal pane sees them.
  useEffect(() => {
    if (!active) return;
    const directions: Record<string, "left" | "right" | "up" | "down"> = {
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return;
      if (event.isComposing || event.getModifierState("AltGraph")) return;
      const target = event.target;
      if (
        !(target instanceof Element) ||
        !target.closest('[data-onirigiri-surface-kind="terminal"]')
      ) {
        return;
      }
      const direction = directions[event.key];
      if (!direction && event.code !== "KeyO") return;
      event.preventDefault();
      event.stopPropagation();
      const workspace = workspaceRef.current;
      // The terminal keeps the keyboard when there is no pane to move to.
      const moved = direction ? workspace?.focus(direction) : (workspace?.toggleOverview(), true);
      if (moved && target instanceof HTMLElement) target.blur();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyN" || !event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.shiftKey || event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select"))
      ) {
        return;
      }
      event.preventDefault();
      addPane();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, addPane]);

  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const onPaneClose = useCallback(
    async (pane: WorkspacePane) => {
      const tool = toolPanes.find((candidate) => candidate.paneId === pane.paneId);
      if (!tool) return false;
      // A terminal whose session would not close keeps its pane.
      if (tool.kind === "terminal" && tool.terminalId) {
        const closed = await closeTerminal({
          environmentId: tool.environmentId,
          input: { threadId: tool.threadId, terminalId: tool.terminalId, deleteHistory: true },
        });
        if (closed._tag !== "Success") return false;
      }
      // The rebuilt arrangement drops the pane, so the workspace does not
      // close it itself; focus returns to its thread.
      pendingFocusPaneIdRef.current = threadPaneId(tool.environmentId, tool.threadId);
      remove(tool.paneId);
      return false;
    },
    [closeTerminal, remove, toolPanes],
  );

  const renderPane = useCallback(
    (pane: WorkspacePane, state: OnirigiriPaneRenderState) => {
      if (pane.surfaceKind === "empty") {
        return (
          <EmptyPane
            threadTitle={pane.subtitle}
            focused={state.focused}
            onChoose={(kind) => choose(pane.paneId, kind)}
            onClose={() => void workspaceRef.current?.closePane(pane.paneId)}
          />
        );
      }
      if (pane.surfaceKind === "terminal") {
        const tool = pane.data as ToolPane;
        if (!tool.terminalId) return null;
        return (
          <TerminalPane
            thread={tool}
            terminalId={tool.terminalId}
            focused={state.focused}
            live={state.runtimeState === "live"}
          />
        );
      }
      if (pane.surfaceKind === "diff") return <DiffPane thread={pane.data as ToolPane} />;
      if (pane.surfaceKind !== "thread") return null;
      return (
        <ThreadPane
          thread={pane.data as ThreadPaneData}
          focused={state.focused}
          visible={state.visible}
          paneId={pane.paneId}
          onNavigateAway={navigateAway}
        />
      );
    },
    [choose, navigateAway],
  );

  // A valid picture remains a visual cover while the same thread refreshes.
  const renderPanePlaceholder = useCallback(
    (pane: WorkspacePane) => {
      if (pane.surfaceKind !== "thread") return null;
      const data = pane.data as ThreadPaneData;
      const card = <ThreadCard environmentId={data.environmentId} threadId={data.threadId} />;
      const image = pictureFor(pane.paneId);
      return image ? (
        <SavedPanePicture
          image={image}
          preparedUrl={preparedPictureUrl(image)}
          pictureUrl={pictureUrl}
          summary={card}
        />
      ) : (
        card
      );
    },
    [pictureFor, pictureUrl, preparedPictureUrl],
  );

  return (
    <div ref={stageRef} className="spatial-workspace flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-end bg-[color-mix(in_oklch,var(--background)_94%,var(--foreground))]">
        <AddPaneButton onAdd={addPane} />
        <FocusAnchorToggle focusAnchor={focusAnchor} onToggle={toggleFocusAnchor} />
        <div ref={setControlsContainer} />
      </div>
      {initialPanes && lifecycle ? (
        <SpatialWorkspaceActiveContext value={active}>
          <PaneLifecycleContext value={lifecycle}>
            <PaneSnapshotContext value={requestSnapshot}>
              <OnirigiriWorkspace
                ref={workspaceRef}
                ariaLabel="Onirigiri for T3 Code"
                className="min-h-0 flex-1"
                cursorRunway={0}
                cursorTargets="panes"
                desktopControlsContainer={controlsContainer}
                focusAnchor={focusAnchor}
                getPanePicture={getPanePicture}
                gridAxes={layoutMode === "strip" ? "horizontal" : "spatial"}
                initialPanes={initialPanes}
                liveContent
                onFocusedPaneFrame={onFocusedPaneFrame}
                onLayoutChange={onLayoutChange}
                onPaneClose={onPaneClose}
                onPanePictureCaptured={onPanePictureCaptured}
                renderPane={renderPane}
                renderPanePlaceholder={renderPanePlaceholder}
                shortcutScope={active ? "application" : "workspace"}
                shortcuts={SHORTCUTS}
                workspaceId={WORKSPACE_ID}
              />
            </PaneSnapshotContext>
          </PaneLifecycleContext>
        </SpatialWorkspaceActiveContext>
      ) : null}
    </div>
  );
}
