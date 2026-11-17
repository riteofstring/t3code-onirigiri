import { pictureLog } from "./PictureStatusPanel";
import { isDeferredPane } from "./deferredPanes";
import { flushPaneVisualChanges } from "./paneVisualChanges";
import type { PanePresentationResolver, WorkspaceScene } from "@riteofstring/onirigiri";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTheme } from "@t3tools/web/src/hooks/useTheme";
import { useClientSettings } from "@t3tools/web/src/hooks/useSettings";
import { useThreadShells } from "@t3tools/web/src/state/entities";

import {
  MAX_SAVED,
  MAX_SAVED_BYTES,
  loadPanePictures,
  pictureRecordKey,
  savePanePicture,
  type SavedPanePicture,
} from "./panePictureStore";
import type { PictureMount } from "./paneLifecycle";
import { snapshotPanePicture } from "./panePictureSnapshot";
import { createPanePictureUrls } from "./panePictureUrls";
import { createSnapshotQueue } from "./panePictureQueue";
import { threadPaneId } from "./useWorkspacePanes";
import { readItem, writeItem } from "./useWorkspacePreferences";

interface PaneContentRevision {
  updatedAt: string;
  theme: string;
}

const themeKey = () => {
  const root = document.documentElement;
  return `${root.classList.contains("dark") ? "dark" : "light"}:${root.dataset.themeId ?? ""}`;
};
const syncedPanes = new Map<string, PaneContentRevision & { visualRevision: number }>();

function contentKey(content: PaneContentRevision): string {
  return `${content.updatedAt}|${content.theme}|chat-chrome-2`;
}

const SNAPSHOT_REVISION = "native-worker-9";

function pictureRevision(revision: string): string {
  return `${revision}|${SNAPSHOT_REVISION}`;
}

function currentImplementation(picture: SavedPanePicture): boolean {
  return picture.revision.endsWith(`|${SNAPSHOT_REVISION}`);
}

function paneHasCommittedContent(
  paneId: string,
  expected: PaneContentRevision,
  visualRevision: number,
): boolean {
  const committed = syncedPanes.get(paneId);
  return (
    committed !== undefined &&
    committed.updatedAt >= expected.updatedAt &&
    committed.theme === expected.theme &&
    committed.visualRevision === visualRevision
  );
}

export interface PictureMotion {
  readonly holdsLive: (paneId: string) => boolean | undefined;
  /** At rest, a chat still under its picture until its turn to reappear. */
  readonly coveredAtRest?: (paneId: string) => boolean;
  readonly revealStep?: number;
  readonly focusedAt?: (paneId: string) => number;
  readonly moving: boolean;
}

export type RequestPaneSnapshot = (paneId: string, element: HTMLElement) => number;

interface PaneSnapshots {
  hasFreshPicture: (paneId: string) => boolean;
  geometryVersion: number;
  timelinePicture: (paneId: string) => { url: string; width: number; height: number } | null;
  request: RequestPaneSnapshot;
  invalidate: (paneId: string, committed?: boolean) => void;
  setLiveProducer: (paneId: string, present: boolean) => number;
}

export const PaneSnapshotContext = createContext<PaneSnapshots | null>(null);

const OTHER_PANES_KEY = "onirigiri.otherPanes";
const otherPanePictures = (() => {
  if (typeof window === "undefined") return false;
  const requested = new URLSearchParams(window.location.search).get("otherPanes");
  if (requested === "pictures" || requested === "live") writeItem(OTHER_PANES_KEY, requested);
  return readItem(OTHER_PANES_KEY) === "pictures";
})();
export function usePanePictureTheme(): string {
  const { theme, resolvedTheme, themeHalves } = useTheme();
  const fonts = useClientSettings((settings) =>
    JSON.stringify([
      settings.fontFamilySans,
      settings.fontFamilyCode,
      settings.fontFamilyComposer,
      settings.fontSizeInterface,
      settings.fontSizePrompt,
      settings.fontSizeCode,
      settings.fontSmoothing,
    ]),
  );
  return `${themeHalves?.[resolvedTheme] ?? theme}|${resolvedTheme}|${fonts}`;
}

export function markPaneSynced(
  paneId: string,
  content: PaneContentRevision | null,
  visualRevision = 0,
) {
  if (content) syncedPanes.set(paneId, { ...content, visualRevision });
  else syncedPanes.delete(paneId);
}

type PictureScene = Pick<WorkspaceScene, "panes" | "columns" | "paneDefaults" | "paneTypeDefaults">;

function paneGeometry(scene: PictureScene): Map<string, string> {
  const defaults = new Map(
    scene.panes.map((pane) => [
      pane.paneId,
      [scene.paneTypeDefaults?.[pane.surfaceKind], pane.defaults],
    ]),
  );
  return new Map(
    scene.columns.flatMap((column) => {
      const sizing = JSON.stringify([
        scene.paneDefaults,
        column.widthSpec,
        column.cells.map((cell) => [
          cell.heightPx,
          cell.weight,
          typeof cell.paneId === "string" ? defaults.get(cell.paneId) : null,
        ]),
      ]);
      return column.cells.flatMap((cell, index) =>
        typeof cell.paneId === "string" ? [[cell.paneId, `${sizing}|${index}`] as const] : [],
      );
    }),
  );
}

export function useSavedPanePictures(
  getScene: () => PictureScene | null,
  onSnapshotFailure: (paneId: string, startedAt: number) => void,
  pictureMount: (paneId: string) => PictureMount = () => "ordinary",
  enabled = true,
  motion?: PictureMotion,
): {
  getPanePresentation: PanePresentationResolver;
  onLayoutChange: () => void;
  pictureFor: (paneId: string) => SavedPanePicture | null;
  displayedPictureFor: (paneId: string) => SavedPanePicture | null;
  preparedPictureUrl: (image: Blob) => string | null;
  pictureUrl: (image: Blob) => string;
  hasFreshPicture: (paneId: string) => boolean;
  canBackgroundPicture: (paneId: string, visited?: boolean) => boolean;
  picturesLoaded: boolean;
  paneSnapshots: PaneSnapshots;
  setCaptureActivity: (enabled: boolean, moving: boolean) => void;
  setPicturesCovered: (covered: boolean) => void;
  stageRef: (element: HTMLElement | null) => void;
  stageViewport: { width: number; height: number; compact: boolean };
  pictureStatus: () => Record<string, string | number | boolean>;
} {
  "use no memo";
  const holdsLiveInMotion = motion?.holdsLive;
  const cameraMoving = motion?.moving ?? false;
  const coveredAtRest = motion?.coveredAtRest;
  const revealStep = motion?.revealStep ?? 0;
  const threads = useThreadShells();
  const pictureTheme = usePanePictureTheme();
  const [saved, setSaved] = useState<ReadonlyMap<string, SavedPanePicture> | null>(null);
  const savedRef = useRef(saved);
  const [liveProducers, setLiveProducers] = useState<ReadonlyMap<string, "live">>(new Map());
  const liveProducersRef = useRef(liveProducers);
  const updateLiveProducers = useCallback((next: ReadonlyMap<string, "live">) => {
    liveProducersRef.current = next;
    setLiveProducers(next);
  }, []);
  const updateSaved = useCallback((pictures: Map<string, SavedPanePicture>) => {
    let count = 0;
    let bytes = 0;
    const kept = [...pictures.values()]
      .toSorted((a, b) => b.savedAt - a.savedAt)
      .filter((picture) => {
        count += 1;
        bytes += picture.image.size;
        return count <= MAX_SAVED && bytes <= MAX_SAVED_BYTES;
      });
    const next =
      kept.length === pictures.size
        ? pictures
        : new Map(kept.map((picture) => [picture.recordKey, picture]));
    savedRef.current = next;
    setSaved(next);
  }, []);
  const visualRevisions = useRef(new Map<string, number>());
  const pictureVisualRevisions = useRef(new WeakMap<Blob, number>());
  const visualRevision = useCallback(
    (paneId: string) => visualRevisions.current.get(paneId) ?? 0,
    [],
  );
  const pictureMatchesVisualRevision = useCallback(
    (paneId: string, image: Blob) =>
      pictureVisualRevisions.current.get(image) === visualRevision(paneId),
    [visualRevision],
  );
  const paneGeometryRef = useRef<Map<string, string> | null>(null);
  const stageSizeRef = useRef("");
  const compactRef = useRef(false);
  const pictureMountRef = useRef(pictureMount);
  const focusedAtRef = useRef(motion?.focusedAt);
  useLayoutEffect(() => {
    pictureMountRef.current = pictureMount;
    focusedAtRef.current = motion?.focusedAt;
  }, [motion?.focusedAt, pictureMount]);
  const [stageViewport, setStageViewport] = useState({ width: 0, height: 0, compact: false });
  const [geometryVersion, setGeometryVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    loadPanePictures()
      .catch(() => new Map<string, SavedPanePicture>())
      .then((pictures) => {
        if (!current) return;
        for (const picture of pictures.values())
          if (!visualRevisions.current.has(picture.paneId))
            pictureVisualRevisions.current.set(picture.image, 0);
        updateSaved(new Map([...pictures, ...(savedRef.current ?? [])]));
      });
    return () => {
      current = false;
    };
  }, [enabled, updateSaved]);

  const workspaceElementRef = useRef<HTMLElement | null>(null);
  const observedStageRef = useRef<HTMLElement | null>(null);
  const stopObservingStageRef = useRef<(() => void) | null>(null);
  const observeStage = useCallback(() => {
    const workspace = workspaceElementRef.current;
    if (workspace && observedStageRef.current?.parentElement?.parentElement === workspace) return;
    const stage =
      workspace?.querySelector<HTMLElement>(
        ':scope > [data-onirigiri-slot="workspace"] > [data-onirigiri-slot="stage"]',
      ) ?? null;
    if (stage === observedStageRef.current) return;
    stopObservingStageRef.current?.();
    stopObservingStageRef.current = null;
    observedStageRef.current = stage;
    stageSizeRef.current = "";
    const engine = stage?.parentElement;
    if (!workspace || !stage || !engine) return;
    const syncCompact = () => {
      if (observedStageRef.current !== stage) return;
      const compact = engine.dataset.compactLayout === "true";
      if (workspace.dataset.spatialCompact !== String(compact))
        workspace.dataset.spatialCompact = String(compact);
      if (compactRef.current !== compact) {
        compactRef.current = compact;
        setGeometryVersion((version) => version + 1);
      }
      setStageViewport((previous) =>
        previous.compact === compact ? previous : { ...previous, compact },
      );
    };
    const compactObserver = new MutationObserver(syncCompact);
    compactObserver.observe(engine, {
      attributes: true,
      attributeFilter: ["data-compact-layout"],
    });
    syncCompact();
    const observer = new ResizeObserver(([entry]) => {
      if (observedStageRef.current !== stage) return;
      const size = entry?.contentRect;
      if (!size || size.width <= 0 || size.height <= 0) return;
      const viewport = {
        width: Math.round(size.width),
        height: Math.round(size.height),
      };
      setStageViewport((previous) =>
        previous.width === viewport.width && previous.height === viewport.height
          ? previous
          : { ...previous, ...viewport },
      );
      const next = `${Math.round(size.width)}x${Math.round(size.height)}`;
      if (stageSizeRef.current === next) return;
      stageSizeRef.current = next;
      setGeometryVersion((version) => version + 1);
    });
    observer.observe(stage);
    let resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const pixelRatioChanged = () => {
      if (observedStageRef.current !== stage) return;
      resolution.removeEventListener("change", pixelRatioChanged);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener("change", pixelRatioChanged);
      setGeometryVersion((version) => version + 1);
    };
    resolution.addEventListener("change", pixelRatioChanged);
    let theme = themeKey();
    const themeObserver = new MutationObserver(() => {
      if (observedStageRef.current !== stage || themeKey() === theme) return;
      theme = themeKey();
      setGeometryVersion((version) => version + 1);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme-id"],
    });
    stopObservingStageRef.current = () => {
      themeObserver.disconnect();
      compactObserver.disconnect();
      delete workspace.dataset.spatialCompact;
      observer.disconnect();
      resolution.removeEventListener("change", pixelRatioChanged);
    };
  }, []);
  const stageRef = useCallback(
    (element: HTMLElement | null) => {
      workspaceElementRef.current = element;
      if (element) {
        const { width, height } = element.getBoundingClientRect();
        if (width > 0 && height > 0)
          setStageViewport((previous) =>
            previous.width > 0
              ? previous
              : { ...previous, width: Math.round(width), height: Math.round(height) },
          );
      }
      observeStage();
    },
    [observeStage],
  );

  const onLayoutChange = useCallback(() => {
    observeStage();
    if (!enabled) return;
    const scene = getScene();
    if (!scene) return;
    const next = paneGeometry(scene);
    const previous = paneGeometryRef.current;
    paneGeometryRef.current = next;
    if (
      !previous ||
      previous.size !== next.size ||
      [...next].some(([paneId, sizing]) => previous.get(paneId) !== sizing)
    )
      setGeometryVersion((version) => version + 1);
    if ([...liveProducersRef.current.keys()].some((paneId) => !next.has(paneId))) {
      updateLiveProducers(
        new Map([...liveProducersRef.current].filter(([paneId]) => next.has(paneId))),
      );
    }
  }, [enabled, getScene, observeStage, updateLiveProducers]);

  const geometryRevision = useCallback(
    (paneId: string) => {
      if (!stageSizeRef.current) return null;
      if (!paneGeometryRef.current) {
        const scene = getScene();
        if (!scene) return null;
        paneGeometryRef.current = paneGeometry(scene);
      }
      const sizing = paneGeometryRef.current.get(paneId);
      return sizing
        ? `stage:${stageSizeRef.current}@${window.devicePixelRatio}|${themeKey()}|${sizing}|${compactRef.current ? "compact" : "tiled"}`
        : null;
    },
    [getScene],
  );
  const expectedRevision = useCallback(
    (paneId: string, contents: ReadonlyMap<string, PaneContentRevision>) => {
      const content = contents.get(paneId);
      const geometry = geometryRevision(paneId);
      return content && geometry ? `${contentKey(content)}|${geometry}` : null;
    },
    [geometryRevision],
  );
  const recordKey = useCallback(
    (paneId: string) => {
      const geometry = geometryRevision(paneId);
      return geometry ? pictureRecordKey(paneId, geometry) : null;
    },
    [geometryRevision],
  );

  const readContentRevisions = () =>
    new Map(
      threads.map((thread) => [
        threadPaneId(thread.environmentId, thread.id),
        { updatedAt: thread.updatedAt, theme: pictureTheme },
      ]),
    );
  const [contentRevisions, setContentRevisions] = useState(readContentRevisions);
  if (
    contentRevisions.size !== threads.length ||
    threads.some((thread) => {
      const previous = contentRevisions.get(threadPaneId(thread.environmentId, thread.id));
      return previous?.updatedAt !== thread.updatedAt || previous.theme !== pictureTheme;
    })
  )
    setContentRevisions(readContentRevisions());
  const contentRevisionsRef = useRef(contentRevisions);
  const runningPanes = useMemo(
    () =>
      new Set(
        threads
          .filter((thread) => threadRuntimeIsActive(thread.runtime))
          .map((thread) => threadPaneId(thread.environmentId, thread.id)),
      ),
    [threads],
  );
  const savedHere = useMemo(() => {
    let count = 0;
    let bytes = 0;
    let largest = 0;
    for (const picture of saved?.values() ?? []) {
      // oxlint-disable-next-line react/refs -- Observer geometry is published through geometryVersion before counting current records.
      if (!contentRevisions.has(picture.paneId) || recordKey(picture.paneId) !== picture.recordKey)
        continue;
      count += 1;
      bytes += picture.image.size;
      largest = Math.max(largest, picture.image.size);
    }
    return { count, bytes, largest };
    // oxlint-disable-next-line react/memo-dependencies -- Observer geometry selects which records occupy the current display's preparation budget.
  }, [contentRevisions, geometryVersion, recordKey, saved]);
  const canBackgroundPicture = useCallback(
    (paneId: string, visited = false) => {
      if (!enabled) return false;
      const key = recordKey(paneId);
      if (key === null || liveProducers.get(paneId) === "live" || runningPanes.has(paneId))
        return false;
      if (visited || saved === null || saved.has(key)) return true;
      return savedHere.count < MAX_SAVED && savedHere.bytes + savedHere.largest <= MAX_SAVED_BYTES;
    },
    [enabled, recordKey, liveProducers, runningPanes, saved, savedHere],
  );
  const runningPanesRef = useRef(runningPanes);
  useLayoutEffect(() => {
    contentRevisionsRef.current = contentRevisions;
    runningPanesRef.current = runningPanes;
  }, [contentRevisions, runningPanes]);

  const isCurrentPicture = useCallback(
    (paneId: string, picture: SavedPanePicture, content: PaneContentRevision) =>
      picture.revision === pictureRevision(contentKey(content)) &&
      pictureMatchesVisualRevision(paneId, picture.image),
    [pictureMatchesVisualRevision],
  );
  const freshPictureFor = useCallback(
    (paneId: string): SavedPanePicture | null => {
      if (liveProducersRef.current.get(paneId) === "live") return null;
      const key = recordKey(paneId);
      const picture = key === null ? undefined : saved?.get(key);
      const content = contentRevisions.get(paneId);
      return picture && content && isCurrentPicture(paneId, picture, content) ? picture : null;
    },
    [contentRevisions, isCurrentPicture, recordKey, saved],
  );

  const [pictureUrls] = useState(createPanePictureUrls);
  const pictureFor = useCallback(
    (paneId: string): SavedPanePicture | null => {
      if (!enabled || liveProducersRef.current.get(paneId) === "live") return null;
      const key = recordKey(paneId);
      const picture = key === null ? undefined : saved?.get(key);
      const content = contentRevisionsRef.current.get(paneId);
      return picture && content && isCurrentPicture(paneId, picture, content) ? picture : null;
    },
    // oxlint-disable-next-line react/memo-dependencies -- Observer geometry changes which record is current.
    [enabled, geometryVersion, isCurrentPicture, recordKey, saved],
  );
  const displayedPictureFor = useCallback(
    (paneId: string): SavedPanePicture | null => {
      const fresh = pictureFor(paneId);
      if (fresh || !enabled) return fresh;
      const key = recordKey(paneId);
      const picture = key === null ? undefined : saved?.get(key);
      return picture && currentImplementation(picture) ? picture : null;
    },
    [enabled, pictureFor, recordKey, saved],
  );
  useLayoutEffect(() => {
    if (!enabled) return;
    pictureUrls.retain(
      new Set(
        [...contentRevisions.keys()].flatMap((paneId) => {
          const picture = displayedPictureFor(paneId);
          return picture ? [picture.image] : [];
        }),
      ),
    );
  }, [
    contentRevisions,
    enabled,
    displayedPictureFor,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Geometry, live producers and saved pictures change which picture URLs are displayed.
    geometryVersion,
    pictureUrls,
    liveProducers,
    saved,
  ]);
  useEffect(() => () => pictureUrls.dispose(), [pictureUrls]);
  const hasFreshPicture = useCallback(
    (paneId: string) => freshPictureFor(paneId) !== null,
    // oxlint-disable-next-line react/memo-dependencies -- Observer refs need to publish geometry changes to the lifecycle.
    [freshPictureFor, geometryVersion],
  );
  const getPanePresentation = useCallback<PanePresentationResolver>(
    (pane, { phase, visible, maximized, capabilities }) => {
      if (!enabled || maximized) return "dom";
      if (pane.surfaceKind !== "thread")
        return otherPanePictures &&
          capabilities.canCapture === true &&
          (phase === "motion" || phase === "resize")
          ? { kind: "texture" }
          : "dom";
      if (
        visible &&
        (phase === "rest" || (phase === "resize" && holdsLiveInMotion?.(pane.paneId) === undefined))
      )
        return phase === "rest" && coveredAtRest?.(pane.paneId) && freshPictureFor(pane.paneId)
          ? { kind: "placeholder" }
          : "dom";
      if (phase === "motion" || phase === "resize") {
        const holds = holdsLiveInMotion?.(pane.paneId);
        if (holds !== undefined) return holds ? "dom" : { kind: "placeholder" };
        flushPaneVisualChanges(pane.paneId);
        if (pictureMount(pane.paneId) !== null && !displayedPictureFor(pane.paneId)) return "dom";
      }
      return { kind: "placeholder" };
    },
    [
      enabled,
      displayedPictureFor,
      freshPictureFor,
      pictureMount,
      holdsLiveInMotion,
      coveredAtRest,
      // oxlint-disable-next-line react/memo-dependencies -- Motion changes which chats hold their DOM, so the engine must resolve presentations again.
      cameraMoving,
      revealStep,
    ],
  );
  const keepPicture = useCallback(
    (picture: SavedPanePicture, revision: number) => {
      const { paneId } = picture;
      pictureVisualRevisions.current.set(picture.image, revision);
      updateSaved(new Map(savedRef.current ?? []).set(picture.recordKey, picture));
      return savePanePicture(
        picture,
        () =>
          liveProducersRef.current.get(paneId) !== "live" &&
          visualRevision(paneId) === revision &&
          savedRef.current?.get(picture.recordKey)?.image === picture.image,
      );
    },
    [updateSaved, visualRevision],
  );

  const [snapshots] = useState(createSnapshotQueue);
  const drawSnapshot = useCallback(
    async (
      paneId: string,
      element: HTMLElement,
      canStart: () => boolean,
      waitToDraw: () => Promise<boolean>,
      signal: AbortSignal,
    ) => {
      const startedAt = performance.now();
      const revision = () => expectedRevision(paneId, contentRevisionsRef.current);
      const before = revision();
      const geometry = geometryRevision(paneId);
      const beforeContent = contentRevisionsRef.current.get(paneId);
      const beforeVisualRevision = visualRevision(paneId);
      if (before === null || geometry === null || !beforeContent) return;
      const record = pictureRecordKey(paneId, geometry);
      const contentBefore = contentKey(beforeContent);
      const canSnapshot = () => {
        const content = contentRevisionsRef.current.get(paneId);
        return (
          element.isConnected &&
          !isDeferredPane(element) &&
          liveProducersRef.current.get(paneId) !== "live" &&
          !runningPanesRef.current.has(paneId) &&
          revision() === before &&
          visualRevision(paneId) === beforeVisualRevision &&
          content !== undefined &&
          paneHasCommittedContent(paneId, content, beforeVisualRevision) &&
          !snapshots.shown(element) &&
          canStart()
        );
      };
      if (!canSnapshot()) return;
      const previous = savedRef.current?.get(record);
      if (previous && isCurrentPicture(paneId, previous, beforeContent)) return;
      const current = () =>
        liveProducersRef.current.get(paneId) !== "live" &&
        !runningPanesRef.current.has(paneId) &&
        revision() === before &&
        visualRevision(paneId) === beforeVisualRevision;
      pictureLog.started += 1;
      const snapshot = await snapshotPanePicture(
        element,
        canSnapshot,
        async () => (await waitToDraw()) && canSnapshot(),
        signal,
      ).catch((error: unknown) => {
        pictureLog.last = `error: ${String(error).slice(0, 80)}`;
        return null;
      });
      if (!snapshot) {
        if (current() && canSnapshot()) {
          pictureLog.failed += 1;
          if (!pictureLog.last.startsWith("error")) pictureLog.last = "no picture returned";
          onSnapshotFailure(paneId, startedAt);
        }
        return;
      }
      pictureLog.last = `captured ${snapshot.image.size} bytes, not kept`;
      const picture = {
        recordKey: record,
        paneId,
        geometryRevision: geometry,
        revision: pictureRevision(contentBefore),
        image: snapshot.image,
        cssSize: snapshot.cssSize,
        savedAt: Date.now(),
      };
      const keep = async () => {
        if (!current() || !element.isConnected) return;
        await keepPicture(picture, beforeVisualRevision);
        pictureLog.saved += 1;
        pictureLog.last = `saved ${snapshot.image.size} bytes`;
      };
      if (signal.aborted) return keep;
      if (canSnapshot()) await keep();
    },
    [
      expectedRevision,
      geometryRevision,
      isCurrentPicture,
      keepPicture,
      onSnapshotFailure,
      snapshots,
      visualRevision,
    ],
  );
  const drawSnapshotRef = useRef(drawSnapshot);
  useLayoutEffect(() => {
    drawSnapshotRef.current = drawSnapshot;
  }, [drawSnapshot]);
  useEffect(
    () =>
      enabled
        ? snapshots.setDraw(
            (...args) => drawSnapshotRef.current(...args),
            (paneId) => {
              const key = recordKey(paneId);
              const content = contentRevisionsRef.current.get(paneId);
              if (
                key === null ||
                !content ||
                liveProducersRef.current.get(paneId) === "live" ||
                runningPanesRef.current.has(paneId) ||
                !syncedPanes.has(paneId)
              )
                return false;
              const previous = savedRef.current?.get(key);
              return !previous || !isCurrentPicture(paneId, previous, content);
            },
            (paneId) => {
              const key = recordKey(paneId);
              return key !== null && savedRef.current?.has(key) === true;
            },
            (paneId) => pictureMountRef.current(paneId),
            (paneId) => focusedAtRef.current?.(paneId) ?? 0,
          )
        : undefined,
    [enabled, isCurrentPicture, recordKey, snapshots],
  );
  const paneSnapshots = useMemo<PaneSnapshots>(
    () => ({
      geometryVersion,
      hasFreshPicture,
      timelinePicture: (paneId) => {
        const picture = displayedPictureFor(paneId);
        const url =
          picture &&
          (pictureUrls.preparedUrl(picture.image) ?? pictureUrls.shownUrl(picture.image));
        return picture && url ? { url, ...picture.cssSize } : null;
      },
      invalidate: (paneId, committed = false) => {
        if (!enabled) return;
        const previous = visualRevision(paneId);
        const next = previous + 1;
        visualRevisions.current.set(paneId, next);
        const content = syncedPanes.get(paneId);
        if (committed && content?.visualRevision === previous)
          syncedPanes.set(paneId, { ...content, visualRevision: next });
      },
      setLiveProducer: (paneId, present) => {
        if (!enabled) return visualRevision(paneId);
        const previous = liveProducersRef.current.get(paneId);
        if (present === (previous === "live")) return visualRevision(paneId);
        const next = new Map(liveProducersRef.current);
        if (present) next.set(paneId, "live");
        else next.delete(paneId);
        updateLiveProducers(next);
        visualRevisions.current.set(paneId, visualRevision(paneId) + 1);
        return visualRevision(paneId);
      },
      request: (paneId, element) => {
        if (!enabled) return visualRevision(paneId);
        snapshots.request(paneId, element);
        return visualRevision(paneId);
      },
    }),
    [
      enabled,
      geometryVersion,
      hasFreshPicture,
      displayedPictureFor,
      pictureUrls,
      snapshots,
      updateLiveProducers,
      visualRevision,
    ],
  );

  const pictureStatus = useCallback(() => {
    const chats = [...contentRevisionsRef.current.keys()];
    return {
      "pictures enabled": enabled,
      "stage measured": stageSizeRef.current !== "",
      "chats with a current picture": `${chats.filter((id) => pictureFor(id) !== null).length} of ${chats.length}`,
      "pictures stored": savedRef.current?.size ?? "loading",
      "chats running": runningPanesRef.current.size,
    };
  }, [enabled, pictureFor]);

  return {
    pictureStatus,
    getPanePresentation,
    onLayoutChange,
    pictureFor,
    displayedPictureFor,
    preparedPictureUrl: pictureUrls.preparedUrl,
    pictureUrl: pictureUrls.urlFor,
    hasFreshPicture,
    canBackgroundPicture,
    picturesLoaded: !enabled || saved !== null,
    paneSnapshots,
    setCaptureActivity: snapshots.setActivity,
    setPicturesCovered: snapshots.setCovered,
    stageRef,
    stageViewport,
  };
}
