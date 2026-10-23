import { useOnirigiriPaneContentReady, useOnirigiriPaneInteractive } from "@riteofstring/onirigiri";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from "@tanstack/react-router";
import {
  createContext,
  memo,
  startTransition,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ChatViewActivityContext } from "@t3tools/web/src/components/chatViewActivity";
import { ChatViewContentReadyProvider } from "@t3tools/web/src/components/chatViewContentReady";
import type { ChatComposerHandle } from "@t3tools/web/src/components/chat/ChatComposer";
import {
  ComposerHandleContext,
  type ComposerHandleRef,
  useComposerHandleContext,
} from "@t3tools/web/src/composerHandleContext";
import { ChatPaneControlsContext } from "@t3tools/web/src/components/chatPaneControls";
import { ThreadRouteView } from "@t3tools/web/src/components/ThreadRouteView";
import {
  useThreadHistory,
  useThreadProjection,
  useThreadShell,
  useThreadStatus,
} from "@t3tools/web/src/state/entities";
import { resolveThreadRouteTarget } from "@t3tools/web/src/threadRoutes";
import {
  PanelAnimationSuppressionProvider,
  usePanelNavigationSuppression,
} from "@t3tools/web/src/panelAnimations";

import { usePaneActivity } from "./paneActivity";
import { PaneLifecycleContext, usePaneMounted } from "./paneLifecycle";
import { hasLivePaneProducer } from "./panePictureSnapshot";
import { PICTURE_IDLE_BUDGET_MS } from "./panePictureIdle";
import { PaneSnapshotContext, markPaneSynced, usePanePictureTheme } from "./useSavedPanePictures";

export const SpatialWorkspaceActiveContext = createContext(true);

export interface ThreadPaneThread {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

function PaneThreadRoute() {
  const target = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  return target ? <ThreadRouteView target={target} /> : null;
}

const paneRootRoute = createRootRoute({ component: Outlet });
const paneRouteTree = paneRootRoute.addChildren([
  createRoute({
    getParentRoute: () => paneRootRoute,
    path: "$environmentId/$threadId",
    component: PaneThreadRoute,
  }),
]);

const PaneRouter = memo(function PaneRouter({
  router,
  threadPath,
}: {
  router: ReturnType<typeof createPaneRouter>;
  threadPath: string;
}) {
  const suppressed = usePanelNavigationSuppression(threadPath);
  return (
    <PanelAnimationSuppressionProvider value={suppressed}>
      <RouterProvider router={router} />
    </PanelAnimationSuppressionProvider>
  );
});

function usePaneContent(
  paneId: string,
  thread: ThreadPaneThread,
  visible: boolean,
  focused: boolean,
  visualRevision: number,
): {
  mounted: boolean;
  preparing: boolean;
  picturable: string | null;
  onContentReadyChange: (ready: boolean) => void;
} {
  const lifecycle = use(PaneLifecycleContext);
  const mounted = usePaneMounted(paneId, visible);
  const shell = useThreadShell(thread);
  const projection = useThreadProjection(mounted ? thread : null)?.projection ?? null;
  const history = useThreadHistory(mounted ? thread : null);
  const updatedAt = shell?.updatedAt ?? null;
  const projectionUpdatedAt = projection ? DateTime.formatIso(projection.updatedAt) : null;
  const status = useThreadStatus(mounted ? thread : null);
  const [contentMounted, setContentMounted] = useState(false);
  const contentAvailable = focused || projection !== null || status === "deleted";
  const renderContent = mounted && contentMounted;
  useEffect(() => {
    if (!mounted) setContentMounted(false);
    else if (contentAvailable && !contentMounted) {
      const show = () => startTransition(() => setContentMounted(true));
      let idle: number | null = null;
      const prepare = () => {
        if (idle !== null) cancelIdleCallback(idle);
        idle = null;
        if (!focused && lifecycle?.isMoving()) return;
        if (focused || visible) show();
        else
          idle = requestIdleCallback((deadline) => {
            idle = null;
            if (deadline.timeRemaining() < PICTURE_IDLE_BUDGET_MS) prepare();
            else show();
          });
      };
      const unsubscribe = lifecycle?.subscribeMotion(prepare);
      prepare();
      return () => {
        unsubscribe?.();
        if (idle !== null) cancelIdleCallback(idle);
      };
    }
  }, [contentAvailable, contentMounted, focused, lifecycle, mounted, visible]);
  const synced = status === "live" || status === "deleted";
  const pictureTheme = usePanePictureTheme();
  const running = threadRuntimeIsActive(shell?.runtime);
  const [contentRevision, setContentRevision] = useState({ updatedAt, projectionUpdatedAt });
  const nextProjectionUpdatedAt = mounted
    ? projectionUpdatedAt
    : contentRevision.projectionUpdatedAt;
  if (
    !running &&
    (contentRevision.updatedAt !== updatedAt ||
      contentRevision.projectionUpdatedAt !== nextProjectionUpdatedAt)
  )
    setContentRevision({ updatedAt, projectionUpdatedAt: nextProjectionUpdatedAt });
  const revision = `${contentRevision.updatedAt}|${contentRevision.projectionUpdatedAt}|${pictureTheme}`;
  const [settled, setSettled] = useState(false);
  const [viewReady, setViewReady] = useState(false);
  const contentReady = status === "deleted" || (viewReady && !history.loading);
  const prepared = renderContent && synced && contentReady && settled;
  const [presented, setPresented] = useState(false);
  if (presented && !renderContent) setPresented(false);
  else if (!presented && prepared) setPresented(true);

  useEffect(() => {
    lifecycle?.committed(paneId, renderContent && presented);
  }, [lifecycle, mounted, paneId, presented, renderContent]);

  useLayoutEffect(() => {
    markPaneSynced(
      paneId,
      prepared && projectionUpdatedAt !== null
        ? { updatedAt: projectionUpdatedAt, theme: pictureTheme }
        : null,
      visualRevision,
    );
    return () => markPaneSynced(paneId, null);
  }, [projectionUpdatedAt, paneId, pictureTheme, prepared, visualRevision]);

  useOnirigiriPaneContentReady(
    renderContent && presented,
    `${revision}|${presented && !prepared}|${visualRevision}`,
  );

  useEffect(() => {
    if (!renderContent || !synced || !contentReady) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      setSettled(false);
    };
  }, [contentReady, renderContent, synced]);

  return {
    mounted: renderContent,
    preparing: renderContent && !prepared,
    onContentReadyChange: setViewReady,
    picturable:
      prepared &&
      !running &&
      projectionUpdatedAt !== null &&
      updatedAt !== null &&
      projectionUpdatedAt >= updatedAt
        ? revision
        : null,
  };
}

function createPaneRouter(threadPath: string) {
  return createRouter({
    routeTree: paneRouteTree,
    history: createMemoryHistory({ initialEntries: [threadPath] }),
  });
}

export const ThreadPane = memo(function ThreadPane({
  thread,
  paneId,
  focused,
  visible,
  onNavigateAway,
  maximized = false,
  onAddPane,
  onClosePane,
  onToggleMaximized,
}: {
  thread: ThreadPaneThread;
  paneId: string;
  focused: boolean;
  visible: boolean;
  onNavigateAway: (href: string) => void;
  maximized?: boolean;
  onAddPane?: (paneId: string) => void;
  onClosePane?: (paneId: string) => void;
  onToggleMaximized?: (paneId: string) => void;
}) {
  const paneControls = useMemo(
    () =>
      onAddPane && onClosePane && onToggleMaximized
        ? {
            maximized,
            addPane: () => onAddPane(paneId),
            closePane: () => onClosePane(paneId),
            toggleMaximized: () => onToggleMaximized(paneId),
          }
        : null,
    [maximized, onAddPane, onClosePane, onToggleMaximized, paneId],
  );
  const interactive = useOnirigiriPaneInteractive();
  const workspaceActive = use(SpatialWorkspaceActiveContext);
  const liveVisible = workspaceActive && interactive;
  const active = focused && liveVisible;
  const threadPath = `/${encodeURIComponent(thread.environmentId)}/${encodeURIComponent(thread.threadId)}`;
  const [router] = useState(() => createPaneRouter(threadPath));
  const [visualRevision, setVisualRevision] = useState(0);
  const { mounted, preparing, picturable, onContentReadyChange } = usePaneContent(
    paneId,
    thread,
    visible,
    focused,
    visualRevision,
  );

  const paneComposerRef = usePaneComposerHandle(active);

  const contentRef = useRef<HTMLDivElement>(null);
  const activity = usePaneActivity(active, liveVisible, contentRef);

  const snapshots = use(PaneSnapshotContext);
  const snapshotPrepared = useRef(false);
  const producerInspected = useRef(false);
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    if (!mounted) {
      snapshotPrepared.current = false;
      producerInspected.current = false;
      return;
    }
    const inspectProducer = () => {
      if (snapshots)
        setVisualRevision(snapshots.setLiveProducer(paneId, hasLivePaneProducer(element)));
    };
    if (!producerInspected.current) {
      inspectProducer();
      producerInspected.current = true;
    }
    const producerChanged = (record: MutationRecord) =>
      record.attributeName === "data-browser-surface-slot" ||
      [...record.addedNodes, ...record.removedNodes].some(
        (node) => node instanceof Element && hasLivePaneProducer(node),
      );
    if (picturable !== null) snapshotPrepared.current = true;
    const invalidate = () => {
      if (!snapshotPrepared.current) return;
      // Active DOM changes need acknowledgement without waking the engine on every scroll.
      if (active && picturable !== null) snapshots?.invalidate(paneId, true);
      else snapshots?.invalidate(paneId);
      if (active || picturable === null || !snapshots) return;
      setVisualRevision(snapshots.request(paneId, element));
    };
    const contentChanged = (records: MutationRecord[]) => {
      const attributes = new Map<Element, Set<string>>();
      return records.some((record) => {
        const { target, type, attributeName, oldValue } = record;
        if (type !== "attributes" || !(target instanceof Element) || attributeName === null)
          return true;
        if (
          target === element &&
          (attributeName === "data-spatial-active" || attributeName === "data-spatial-preparing")
        )
          return false;
        let seen = attributes.get(target);
        if (!seen) attributes.set(target, (seen = new Set()));
        if (seen.has(attributeName)) return false;
        seen.add(attributeName);
        const currentValue = target.getAttribute(attributeName);
        if (attributeName === "class" && target.matches('[data-testid="composer-editor"]')) {
          const pictureClasses = (value: string | null) =>
            (value ?? "")
              .split(/\s+/)
              .filter((name) => name !== "ProseMirror-focused")
              .join(" ")
              .trim();
          return pictureClasses(oldValue) !== pictureClasses(currentValue);
        }
        return oldValue !== currentValue;
      });
    };
    const observer = new MutationObserver((records) => {
      if (records.some(producerChanged)) inspectProducer();
      if (contentChanged(records)) invalidate();
    });
    observer.observe(element, {
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const events = ["wheel", "scroll", "pointerdown", "input", "drop", "load"] as const;
    for (const event of events)
      element.addEventListener(event, invalidate, { capture: true, passive: true });
    return () => {
      const pending = observer.takeRecords();
      if (element.childElementCount > 0) {
        if (pending.some(producerChanged)) inspectProducer();
        if (snapshotPrepared.current && contentChanged(pending)) snapshots?.invalidate(paneId);
      }
      observer.disconnect();
      for (const event of events) element.removeEventListener(event, invalidate, true);
    };
  }, [active, mounted, paneId, picturable, snapshots]);
  useEffect(() => {
    if (picturable !== null && contentRef.current && snapshots) {
      setVisualRevision(snapshots.request(paneId, contentRef.current));
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Visibility retries a previously unmeasurable pane.
  }, [active, paneId, picturable, snapshots, visible]);

  useEffect(
    () =>
      router.history.subscribe(({ location }) => {
        if (location.pathname === threadPath) return;
        onNavigateAway(location.href);
        router.history.replace(threadPath);
      }),
    [onNavigateAway, router, threadPath],
  );

  return (
    <ChatPaneControlsContext value={paneControls}>
      <ChatViewActivityContext value={activity}>
        <ComposerHandleContext value={paneComposerRef}>
          <div
            ref={contentRef}
            onKeyDownCapture={leaveComposerOnEscape}
            className="spatial-thread-pane h-full w-full"
            data-spatial-thread={thread.threadId}
            data-spatial-active={String(active)}
            data-spatial-preparing={preparing ? "" : undefined}
          >
            <ChatViewContentReadyProvider onReadyChange={onContentReadyChange}>
              {mounted ? <PaneRouter router={router} threadPath={threadPath} /> : null}
            </ChatViewContentReadyProvider>
          </div>
        </ComposerHandleContext>
      </ChatViewActivityContext>
    </ChatPaneControlsContext>
  );
});

function usePaneComposerHandle(active: boolean): ComposerHandleRef {
  const appComposerRef = useComposerHandleContext();
  const [pane] = useState(() => {
    let handle: ChatComposerHandle | null = null;
    let connected: ComposerHandleRef | null = null;
    return {
      ref: {
        get current() {
          return handle;
        },
        set current(next: ChatComposerHandle | null) {
          if (connected && connected.current === handle) connected.current = next;
          handle = next;
        },
      },
      connect(app: ComposerHandleRef) {
        connected = app;
        app.current = handle;
        return () => {
          if (connected && connected.current === handle) connected.current = null;
          connected = null;
        };
      },
    };
  });
  useLayoutEffect(() => {
    if (active && appComposerRef) return pane.connect(appComposerRef);
  }, [active, appComposerRef, pane]);
  return pane.ref;
}

function leaveComposerOnEscape(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const editor = target.closest<HTMLElement>('[data-testid="composer-editor"]');
  if (!editor || editor.hasAttribute("aria-controls")) return;
  event.preventDefault();
  editor.blur();
}
