import { flushPaneVisualChanges } from "./paneVisualChanges";
import type { OnirigiriLayout, PanePresentationResolver } from "@riteofstring/onirigiri";
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
  deletePanePictures,
  pictureRecordKey,
  savePanePicture,
  type SavedPanePicture,
} from "./panePictureStore";
import type { PictureMount } from "./paneLifecycle";
import { snapshotPanePicture } from "./panePictureSnapshot";
import { createPanePictureUrls } from "./panePictureUrls";
import { PICTURE_IDLE_BUDGET_MS } from "./panePictureIdle";
import { threadPaneId } from "./useWorkspacePanes";

interface PaneContentRevision {
  updatedAt: string;
  theme: string;
}

const syncedPanes = new Map<string, PaneContentRevision & { visualRevision: number }>();

function contentKey(content: PaneContentRevision): string {
  return `${content.updatedAt}|${content.theme}|chat-chrome-2`;
}

function pictureRevision(revision: string, source: SavedPanePicture["source"]): string {
  return source === "capture" ? revision : `${revision}|native-worker-6`;
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

export type RequestPaneSnapshot = (paneId: string, element: HTMLElement) => number;

interface PaneSnapshots {
  hasFreshPicture: (paneId: string) => boolean;
  pictureMiss: (paneId: string) => string | null;
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
  if (requested === "pictures" || requested === "live")
    window.localStorage.setItem(OTHER_PANES_KEY, requested);
  return window.localStorage.getItem(OTHER_PANES_KEY) === "pictures";
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

function paneGeometry(layout: OnirigiriLayout): Map<string, string> {
  const defaults = new Map(layout.panes.map((pane) => [pane.paneId, pane.defaults]));
  return new Map(
    layout.columns.flatMap((column) => {
      const sizing = JSON.stringify([
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
  getLayout: () => OnirigiriLayout | null,
  onSnapshotFailure: (paneId: string, startedAt: number) => void,
  defaultRowHeight: number | "viewport" = "viewport",
  pictureMount: (paneId: string) => PictureMount = () => "ordinary",
  enabled = true,
  motionDecision?: (paneId: string) => string | null | undefined,
): {
  getPanePresentation: PanePresentationResolver;
  onLayoutChange: (layout: OnirigiriLayout) => void;
  pictureFor: (paneId: string) => SavedPanePicture | null;
  preparedPictureUrl: (image: Blob) => string | null;
  pictureUrl: (image: Blob) => string;
  hasFreshPicture: (paneId: string) => boolean;
  canBackgroundPicture: (paneId: string, visited?: boolean) => boolean;
  runningPanes: ReadonlySet<string>;
  picturesLoaded: boolean;
  paneSnapshots: PaneSnapshots;
  setCaptureActivity: (enabled: boolean, moving: boolean) => void;
  stageRef: (element: HTMLElement | null) => void;
  stageViewport: { width: number; height: number; compact: boolean };
} {
  "use no memo";
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
  useLayoutEffect(() => {
    pictureMountRef.current = pictureMount;
  }, [pictureMount]);
  const [stageViewport, setStageViewport] = useState({ width: 0, height: 0, compact: false });
  const [geometryVersion, setGeometryVersion] = useState(0);
  const defaultRowHeightRef = useRef(defaultRowHeight);
  useLayoutEffect(() => {
    if (defaultRowHeightRef.current === defaultRowHeight) return;
    defaultRowHeightRef.current = defaultRowHeight;
    setGeometryVersion((version) => version + 1);
  }, [defaultRowHeight]);

  const deletedWhileLoading = useRef<Set<string> | null>(new Set());
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    loadPanePictures()
      .catch(() => new Map<string, SavedPanePicture>())
      .then((pictures) => {
        if (!current) return;
        const deleted = deletedWhileLoading.current;
        deletedWhileLoading.current = null;
        for (const picture of pictures.values())
          if (!visualRevisions.current.has(picture.paneId))
            pictureVisualRevisions.current.set(picture.image, 0);
        updateSaved(
          new Map([
            ...[...pictures].filter(([, picture]) => !deleted?.has(picture.paneId)),
            ...(savedRef.current ?? []),
          ]),
        );
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
    stopObservingStageRef.current = () => {
      compactObserver.disconnect();
      delete workspace.dataset.spatialCompact;
      observer.disconnect();
      resolution.removeEventListener("change", pixelRatioChanged);
    };
  }, []);
  const stageRef = useCallback(
    (element: HTMLElement | null) => {
      workspaceElementRef.current = element;
      observeStage();
    },
    [observeStage],
  );

  const onLayoutChange = useCallback(
    (layout: OnirigiriLayout) => {
      observeStage();
      if (!enabled) return;
      const next = paneGeometry(layout);
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
    },
    [enabled, observeStage, updateLiveProducers],
  );

  const geometryRevision = useCallback(
    (paneId: string) => {
      if (!stageSizeRef.current) return null;
      if (!paneGeometryRef.current) {
        const layout = getLayout();
        if (!layout) return null;
        paneGeometryRef.current = paneGeometry(layout);
      }
      const sizing = paneGeometryRef.current.get(paneId);
      const height = defaultRowHeightRef.current;
      return sizing
        ? `stage:${stageSizeRef.current}@${window.devicePixelRatio}|${sizing}${height === "viewport" ? "" : `|row:${height}`}|${compactRef.current ? "compact" : "tiled"}`
        : null;
    },
    [getLayout],
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

  const pictureMiss = useCallback(
    (paneId: string): string | null => {
      if (liveProducersRef.current.get(paneId) === "live") return "live-producer";
      const key = recordKey(paneId);
      if (key === null) return "no-key";
      const picture = saved?.get(key);
      if (!picture) return saved ? "not-saved" : "not-loaded";
      const content = contentRevisions.get(paneId);
      if (!content) return "no-content";
      if (picture.revision !== pictureRevision(contentKey(content), picture.source))
        return "content-changed";
      if (!pictureMatchesVisualRevision(paneId, picture.image)) return "visual-changed";
      return null;
    },
    [contentRevisions, pictureMatchesVisualRevision, recordKey, saved],
  );
  const freshPictureFor = useCallback(
    (paneId: string): SavedPanePicture | null => {
      if (pictureMiss(paneId) !== null) return null;
      const key = recordKey(paneId);
      return (key !== null && saved?.get(key)) || null;
    },
    [pictureMiss, recordKey, saved],
  );

  const [pictureUrls] = useState(createPanePictureUrls);
  const pictureFor = useCallback(
    (paneId: string): SavedPanePicture | null => {
      if (!enabled) return null;
      const key = recordKey(paneId);
      const content = contentRevisionsRef.current.get(paneId);
      const picture = key === null ? undefined : saved?.get(key);
      if (liveProducersRef.current.get(paneId) === "live" || !content) return null;
      const fresh =
        picture &&
        picture.revision === pictureRevision(contentKey(content), picture.source) &&
        pictureMatchesVisualRevision(paneId, picture.image)
          ? picture
          : null;
      return fresh;
    },
    [enabled, geometryVersion, pictureMatchesVisualRevision, recordKey, saved],
  );
  useLayoutEffect(() => {
    if (!enabled) return;
    pictureUrls.retain(
      new Set(
        [...contentRevisions.keys()].flatMap((paneId) => {
          const picture = freshPictureFor(paneId);
          return picture ? [picture.image] : [];
        }),
      ),
    );
  }, [
    contentRevisions,
    enabled,
    freshPictureFor,
    geometryVersion,
    pictureUrls,
    liveProducers,
    saved,
  ]);
  useEffect(() => () => pictureUrls.dispose(), [pictureUrls]);
  const hasFreshPicture = useCallback(
    (paneId: string) => {
      const picture = freshPictureFor(paneId);
      return picture !== null && pictureMatchesVisualRevision(paneId, picture.image);
    },
    // oxlint-disable-next-line react/memo-dependencies -- Observer refs need to publish geometry changes to the lifecycle.
    [freshPictureFor, geometryVersion, pictureMatchesVisualRevision],
  );
  const getPanePresentation = useCallback<PanePresentationResolver>(
    (pane, { phase, visible, maximized }) => {
      if (!enabled || maximized) return "dom";
      if (pane.surfaceKind !== "thread")
        return otherPanePictures && phase !== "rest" ? { kind: "texture" } : "dom";
      if (
        visible &&
        (phase === "rest" || (phase === "resize" && motionDecision?.(pane.paneId) === undefined))
      )
        return "dom";
      if (phase === "motion" || phase === "overview-motion" || phase === "resize") {
        const decision = motionDecision?.(pane.paneId);
        if (decision !== undefined) return decision === null ? { kind: "placeholder" } : "dom";
        flushPaneVisualChanges(pane.paneId);
        if (pictureMount(pane.paneId) !== null && !hasFreshPicture(pane.paneId)) return "dom";
      }
      return { kind: "placeholder" };
    },
    [enabled, hasFreshPicture, pictureMount, motionDecision],
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
          liveProducersRef.current.get(paneId) !== "live" &&
          !runningPanesRef.current.has(paneId) &&
          revision() === before &&
          visualRevision(paneId) === beforeVisualRevision &&
          content !== undefined &&
          paneHasCommittedContent(paneId, content, beforeVisualRevision) &&
          canStart()
        );
      };
      if (!canSnapshot()) return;
      const previous = savedRef.current?.get(record);
      if (
        previous &&
        previous.revision === pictureRevision(contentBefore, previous.source) &&
        pictureMatchesVisualRevision(paneId, previous.image)
      )
        return;
      const current = () =>
        liveProducersRef.current.get(paneId) !== "live" &&
        !runningPanesRef.current.has(paneId) &&
        revision() === before &&
        visualRevision(paneId) === beforeVisualRevision;
      const snapshot = await snapshotPanePicture(
        element,
        canSnapshot,
        async () => (await waitToDraw()) && canSnapshot(),
        signal,
      ).catch(() => null);
      if (!snapshot) {
        if (current() && canSnapshot()) onSnapshotFailure(paneId, startedAt);
        return;
      }
      if (!current() || !canSnapshot() || signal.aborted) return;
      const picture = {
        recordKey: record,
        paneId,
        geometryRevision: geometry,
        revision: pictureRevision(contentBefore, "snapshot"),
        image: snapshot.image,
        cssSize: snapshot.cssSize,
        savedAt: Date.now(),
        source: "snapshot" as const,
      };
      await keepPicture(picture, beforeVisualRevision);
    },
    [
      expectedRevision,
      geometryRevision,
      keepPicture,
      onSnapshotFailure,
      pictureMatchesVisualRevision,
      visualRevision,
    ],
  );
  const drawSnapshotRef = useRef(drawSnapshot);
  useLayoutEffect(() => {
    drawSnapshotRef.current = drawSnapshot;
  }, [drawSnapshot]);
  const [snapshots] = useState(createSnapshotQueue);
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
              return (
                !previous ||
                previous.revision !== pictureRevision(contentKey(content), previous.source) ||
                !pictureMatchesVisualRevision(paneId, previous.image)
              );
            },
            // Missing pictures at the current geometry precede refreshes.
            (paneId) => {
              const key = recordKey(paneId);
              return key !== null && savedRef.current?.has(key) === true;
            },
            (paneId) => pictureMountRef.current(paneId),
          )
        : undefined,
    [enabled, pictureMatchesVisualRevision, recordKey, snapshots],
  );
  const paneSnapshots = useMemo<PaneSnapshots>(
    () => ({
      geometryVersion,
      hasFreshPicture,
      pictureMiss,
      timelinePicture: (paneId) => {
        const picture = pictureFor(paneId);
        const url =
          picture &&
          (pictureUrls.preparedUrl(picture.image) ?? pictureUrls.urlFor(picture.image));
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
        const pictures = new Map(savedRef.current);
        for (const [key, picture] of pictures) {
          if (picture.paneId === paneId) pictures.delete(key);
        }
        if (pictures.size !== (savedRef.current?.size ?? 0)) updateSaved(pictures);
        if (present) {
          deletedWhileLoading.current?.add(paneId);
          void deletePanePictures(paneId).catch(() => {});
        }
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
      pictureMiss,
      pictureFor,
      pictureUrls,
      snapshots,
      updateLiveProducers,
      updateSaved,
      visualRevision,
    ],
  );

  return {
    getPanePresentation,
    onLayoutChange,
    pictureFor,
    preparedPictureUrl: pictureUrls.preparedUrl,
    pictureUrl: pictureUrls.urlFor,
    hasFreshPicture,
    canBackgroundPicture,
    runningPanes,
    picturesLoaded: !enabled || saved !== null,
    paneSnapshots,
    setCaptureActivity: snapshots.setActivity,
    stageRef,
    stageViewport,
  };
}

const SNAPSHOT_RETRY_MS = 3000;
const FIRST_PICTURE_INPUT_QUIET_MS = 250;
const SNAPSHOT_RETRY_LIMIT_MS = 5 * 60_000;

function distanceFromCenter(element: HTMLElement) {
  const { left, top, width, height } = element.getBoundingClientRect();
  return Math.hypot(
    left + width / 2 - window.innerWidth / 2,
    top + height / 2 - window.innerHeight / 2,
  );
}

export function createSnapshotQueue() {
  type Draw = (
    paneId: string,
    element: HTMLElement,
    canStart: () => boolean,
    waitToDraw: () => Promise<boolean>,
    signal: AbortSignal,
  ) => Promise<void>;
  const pending = new Map<
    string,
    { element: HTMLElement; after: number; retryAfter: number; background: boolean }
  >();
  let draw: Draw | null = null;
  let needsPicture: (paneId: string) => boolean = () => false;
  let hasSavedPixels: (paneId: string) => boolean = () => false;
  let mountOf: (paneId: string) => PictureMount = () => "ordinary";
  let enabled = true;
  let moving = false;
  let drawing = false;
  let continuation: {
    paneId: string;
    background: boolean;
    resolve: (admitted: boolean) => void;
    cancel: () => void;
    drop: () => void;
  } | null = null;
  let idle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastInput = performance.now();
  let activeCapture: AbortController | null = null;
  const pointers = new Set<number>();
  const noteInput = (event?: Event) => {
    if (event?.type === "blur" && event.target !== window) return;
    const navigation =
      event instanceof KeyboardEvent &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key.startsWith("Arrow");
    if (!navigation) lastInput = performance.now();
    activeCapture?.abort();
    continuation?.cancel();
    continuation = null;
    if (event?.type === "pointerdown") pointers.add((event as PointerEvent).pointerId);
    else if (
      event?.type === "pointerup" ||
      event?.type === "pointercancel" ||
      event?.type === "lostpointercapture"
    )
      pointers.delete((event as PointerEvent).pointerId);
    else if (event?.type === "blur") pointers.clear();
    cancelScheduled();
    if (event) next();
  };
  const inputEvents = [
    "keydown",
    "beforeinput",
    "input",
    "compositionstart",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "wheel",
    "blur",
  ] as const;
  const quietTime = () => FIRST_PICTURE_INPUT_QUIET_MS;
  const cancelScheduled = () => {
    if (idle !== null) cancelIdleCallback(idle);
    if (timer !== null) clearTimeout(timer);
    idle = null;
    timer = null;
  };
  const next = () => {
    if (
      !enabled ||
      moving ||
      pointers.size > 0 ||
      (drawing && !continuation) ||
      idle !== null ||
      timer !== null ||
      (!continuation && pending.size === 0) ||
      !draw
    )
      return;
    const current = draw;
    idle = requestIdleCallback((deadline) => {
      idle = null;
      if (draw !== current || (!continuation && pending.size === 0)) return;
      if (continuation && mountOf(continuation.paneId) === null) {
        const abandoned = continuation;
        continuation = null;
        abandoned.drop();
        return;
      }
      if (deadline.timeRemaining() < 4) {
        next();
        return;
      }
      const now = performance.now();
      const due = ([_paneId, request]: [string, { after: number; background: boolean }]) =>
        Math.max(lastInput + quietTime(), request.after);
      if (continuation) {
        const resumeAt = lastInput + quietTime();
        if (
          continuation.background &&
          [...pending].some((candidate) => !candidate[1].background && due(candidate) <= resumeAt)
        ) {
          const yielding = continuation;
          continuation = null;
          yielding.cancel();
          return;
        }
        if (resumeAt > now) {
          timer = setTimeout(() => {
            timer = null;
            next();
          }, resumeAt - now);
          return;
        }
        if (continuation.background && deadline.timeRemaining() < PICTURE_IDLE_BUDGET_MS) {
          next();
          return;
        }
        const resume = continuation;
        continuation = null;
        resume.resolve(true);
        return;
      }
      const dueRequests = [...pending].filter((candidate) => due(candidate) <= now);
      const priority = ([paneId, request]: (typeof dueRequests)[number]) =>
        request.background ? 2 : hasSavedPixels(paneId) ? 1 : 0;
      const [paneId, request] = dueRequests.length
        ? dueRequests.sort(
            (a, b) =>
              priority(a) - priority(b) ||
              distanceFromCenter(a[1].element) - distanceFromCenter(b[1].element),
          )[0]!
        : [...pending].reduce((first, candidate) =>
            due(candidate) < due(first) ? candidate : first,
          );
      const wait = due([paneId, request]) - now;
      if (wait > 0) {
        timer = setTimeout(() => {
          timer = null;
          next();
        }, wait);
        return;
      }
      if (request.background && deadline.timeRemaining() < PICTURE_IDLE_BUDGET_MS) {
        next();
        return;
      }
      pending.delete(paneId);
      const owner = mountOf(paneId);
      if (owner === null) {
        next();
        return;
      }
      drawing = true;
      const controller = new AbortController();
      activeCapture = controller;
      const background = request.background && owner === "background";
      let deferred = false;
      let dropped = false;
      const canStart = () => {
        if (mountOf(paneId) === null) dropped = true;
        else if (
          controller.signal.aborted ||
          !enabled ||
          moving ||
          pointers.size > 0 ||
          performance.now() - lastInput < quietTime()
        )
          deferred = true;
        return !deferred && !dropped && draw === current;
      };
      const waitToDraw = () => {
        if (draw !== current || controller.signal.aborted) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
          continuation = {
            paneId,
            background,
            resolve,
            cancel: () => {
              deferred = true;
              resolve(false);
            },
            drop: () => {
              dropped = true;
              resolve(false);
            },
          };
          next();
        });
      };
      void current(paneId, request.element, canStart, waitToDraw, controller.signal)
        .catch(() => {})
        .finally(() => {
          drawing = false;
          if (activeCapture === controller) activeCapture = null;
          if (controller.signal.aborted) deferred = true;
          if (draw === current && !pending.has(paneId) && !dropped) {
            if (deferred) pending.set(paneId, request);
            else if (request.element.isConnected && needsPicture(paneId)) {
              pending.set(paneId, {
                ...request,
                after: performance.now() + request.retryAfter,
                retryAfter: Math.min(request.retryAfter * 2, SNAPSHOT_RETRY_LIMIT_MS),
              });
            }
          }
          next();
        });
    });
  };
  const request = (paneId: string, element: HTMLElement) => {
    if (mountOf(paneId) === null) return;
    pending.set(paneId, {
      element,
      after:
        performance.now() + (mountOf(paneId) === "background" ? FIRST_PICTURE_INPUT_QUIET_MS : 0),
      retryAfter: SNAPSHOT_RETRY_MS,
      background: mountOf(paneId) === "background",
    });
    if (timer !== null) clearTimeout(timer);
    timer = null;
    next();
  };
  const setDraw = (
    nextDraw: Draw,
    nextNeedsPicture: (paneId: string) => boolean,
    nextHasSavedPixels: (paneId: string) => boolean,
    nextMountOf: (paneId: string) => PictureMount = () => "ordinary",
  ) => {
    draw = nextDraw;
    needsPicture = nextNeedsPicture;
    hasSavedPixels = nextHasSavedPixels;
    mountOf = nextMountOf;
    for (const type of inputEvents) {
      window.addEventListener(type, noteInput, { capture: true, passive: true });
    }
    next();
    return () => {
      if (draw !== nextDraw) return;
      activeCapture?.abort();
      draw = null;
      pending.clear();
      pointers.clear();
      cancelScheduled();
      continuation?.resolve(false);
      continuation = null;
      for (const type of inputEvents) {
        window.removeEventListener(type, noteInput, { capture: true });
      }
    };
  };
  const setActivity = (nextEnabled: boolean, nextMoving: boolean) => {
    if (enabled === nextEnabled && moving === nextMoving) return;
    enabled = nextEnabled;
    moving = nextMoving;
    if (!enabled || moving) {
      activeCapture?.abort();
      continuation?.cancel();
      continuation = null;
    }
    cancelScheduled();
    next();
  };
  const pause = () => {
    const previous = { enabled, moving };
    setActivity(false, moving);
    return () => setActivity(previous.enabled, previous.moving);
  };
  return { request, setDraw, setActivity, pause };
}
