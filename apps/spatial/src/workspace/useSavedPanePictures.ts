import type {
  OnirigiriLayout,
  OnirigiriPanePictureCaptureListener,
  OnirigiriPanePictureResolver,
} from "@riteofstring/onirigiri";
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
import { useThreadShells } from "@t3tools/web/src/state/entities";

import {
  MAX_SAVED,
  loadPanePictures,
  savePanePicture,
  type SavedPanePicture,
} from "./panePictureStore";
import { snapshotPanePicture } from "./panePictureSnapshot";
import { threadPaneId } from "./useWorkspacePanes";

const syncedPanes = new Set<string>();

/** Asks for a picture of a mounted pane's content to be drawn when the page is idle. */
export type RequestPaneSnapshot = (
  paneId: string,
  element: HTMLElement,
  preferNative?: boolean,
) => void;

export const PaneSnapshotContext = createContext<RequestPaneSnapshot | null>(null);

/** Records whether a mounted pane shows its thread fully synchronized. */
export function markPaneSynced(paneId: string, synced: boolean) {
  if (synced) syncedPanes.add(paneId);
  else syncedPanes.delete(paneId);
}

function columnWidths(layout: OnirigiriLayout): Map<string, string> {
  return new Map(
    layout.columns.flatMap((column) => {
      const width = JSON.stringify(column.widthSpec);
      return column.cells.flatMap((cell) =>
        typeof cell.paneId === "string" ? [[cell.paneId, width] as const] : [],
      );
    }),
  );
}

/**
 * Thread pictures saved from earlier sessions. A saved picture seeds its pane
 * while it still shows what the thread would: same last update and theme, and
 * the same pane geometry (workspace size, device pixel ratio and column
 * width). Captures of fully synchronized threads are saved for the next load.
 * Where the browser cannot capture panes, mounted panes are drawn from their
 * DOM when the page is idle; those pictures seed their panes at once and are
 * saved too. A seed never replaces a capture.
 */
export function useSavedPanePictures(getLayout: () => OnirigiriLayout | null): {
  getPanePicture: OnirigiriPanePictureResolver;
  onPanePictureCaptured: OnirigiriPanePictureCaptureListener;
  onLayoutChange: (layout: OnirigiriLayout) => void;
  /** A picture validated in this session, retained as cover while its thread refreshes. */
  pictureFor: (paneId: string) => Blob | null;
  hasFreshPicture: (paneId: string) => boolean;
  picturesLoaded: boolean;
  requestSnapshot: RequestPaneSnapshot;
  stageRef: (element: HTMLElement | null) => void;
} {
  const threads = useThreadShells();
  const { resolvedTheme } = useTheme();
  const [saved, setSaved] = useState<ReadonlyMap<string, SavedPanePicture> | null>(null);
  const widthsRef = useRef<Map<string, string> | null>(null);
  const stageSizeRef = useRef("");
  const [geometryVersion, setGeometryVersion] = useState(0);

  useEffect(() => {
    let current = true;
    loadPanePictures()
      .catch(() => new Map<string, SavedPanePicture>())
      .then((pictures) => {
        if (current) setSaved(pictures);
      });
    return () => {
      current = false;
    };
  }, []);

  const stageObserverRef = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((element: HTMLElement | null) => {
    stageObserverRef.current?.disconnect();
    stageObserverRef.current = null;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.contentRect;
      if (!size) return;
      const next = `${Math.round(size.width)}x${Math.round(size.height)}`;
      if (stageSizeRef.current === next) return;
      stageSizeRef.current = next;
      setGeometryVersion((version) => version + 1);
    });
    observer.observe(element);
    stageObserverRef.current = observer;
  }, []);

  const onLayoutChange = useCallback((layout: OnirigiriLayout) => {
    const next = columnWidths(layout);
    const previous = widthsRef.current;
    widthsRef.current = next;
    if (
      !previous ||
      previous.size !== next.size ||
      [...next].some(([paneId, width]) => previous.get(paneId) !== width)
    )
      setGeometryVersion((version) => version + 1);
  }, []);

  const geometryRevision = useCallback(
    (paneId: string) => {
      if (!stageSizeRef.current) return null;
      if (!widthsRef.current) {
        const layout = getLayout();
        if (!layout) return null;
        widthsRef.current = columnWidths(layout);
      }
      const width = widthsRef.current.get(paneId);
      return width ? `${stageSizeRef.current}@${window.devicePixelRatio}|${width}` : null;
    },
    [getLayout],
  );

  const contentRevisions = useMemo(
    () =>
      new Map(
        threads.map((thread) => [
          threadPaneId(thread.environmentId, thread.id),
          `${thread.updatedAt}|${resolvedTheme}`,
        ]),
      ),
    [resolvedTheme, threads],
  );
  const contentRevisionsRef = useRef(contentRevisions);
  useLayoutEffect(() => {
    contentRevisionsRef.current = contentRevisions;
  }, [contentRevisions]);

  const freshPictureFor = useCallback(
    (paneId: string): Blob | null => {
      const picture = saved?.get(paneId);
      if (!picture) return null;
      const content = contentRevisions.get(paneId);
      const geometry = geometryRevision(paneId);
      if (!content || !geometry || picture.revision !== `${content}|${geometry}`) return null;
      return picture.image;
    },
    [contentRevisions, geometryRevision, saved],
  );

  const lastValidPictures = useRef(new Map<string, Blob>());
  const pictureFor = useCallback(
    (paneId: string): Blob | null => {
      if (!saved?.has(paneId) || !contentRevisionsRef.current.has(paneId)) {
        lastValidPictures.current.delete(paneId);
        return null;
      }
      const picture = saved.get(paneId)!;
      const content = contentRevisionsRef.current.get(paneId);
      const geometry = geometryRevision(paneId);
      const fresh =
        geometry && picture.revision === `${content}|${geometry}` ? picture.image : null;
      if (fresh) lastValidPictures.current.set(paneId, fresh);
      return fresh ?? lastValidPictures.current.get(paneId) ?? null;
    },
    [geometryRevision, saved],
  );
  useEffect(() => {
    for (const paneId of lastValidPictures.current.keys()) {
      if (!saved?.has(paneId) || !contentRevisions.has(paneId)) {
        lastValidPictures.current.delete(paneId);
      }
    }
  }, [contentRevisions, saved]);
  const hasFreshPicture = useCallback(
    (paneId: string) => freshPictureFor(paneId) !== null,
    // oxlint-disable-next-line react/memo-dependencies -- Observer refs need to publish geometry changes to the lifecycle.
    [freshPictureFor, geometryVersion],
  );
  const freshPictureForRef = useRef(freshPictureFor);
  useLayoutEffect(() => {
    freshPictureForRef.current = freshPictureFor;
  }, [freshPictureFor]);
  const getPanePicture = useCallback<OnirigiriPanePictureResolver>((pane) => {
    const image = freshPictureForRef.current(pane.paneId);
    return image ? { image, fit: "fill", replaceable: true } : null;
  }, []);

  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);
  const keepPicture = useCallback((picture: SavedPanePicture) => {
    setSaved((current) => {
      const next = new Map(current ?? []).set(picture.paneId, picture);
      if (next.size <= MAX_SAVED) return next;
      const newest = [...next.values()].toSorted((a, b) => b.savedAt - a.savedAt);
      return new Map(newest.slice(0, MAX_SAVED).map((kept) => [kept.paneId, kept]));
    });
  }, []);

  const onPanePictureCaptured = useCallback<OnirigiriPanePictureCaptureListener>(
    (pane, image) => {
      if (!syncedPanes.has(pane.paneId)) return;
      const content = contentRevisionsRef.current.get(pane.paneId);
      const geometry = geometryRevision(pane.paneId);
      if (!content || !geometry) return;
      const picture = {
        paneId: pane.paneId,
        revision: `${content}|${geometry}`,
        image,
        savedAt: Date.now(),
        source: "capture" as const,
      };
      keepPicture(picture);
      void savePanePicture(picture).catch(() => {});
    },
    [geometryRevision, keepPicture],
  );

  const drawSnapshot = useCallback(
    async (paneId: string, element: HTMLElement) => {
      const revision = () => {
        const content = contentRevisionsRef.current.get(paneId);
        const geometry = geometryRevision(paneId);
        return content && geometry ? `${content}|${geometry}` : null;
      };
      const before = revision();
      if (!before || !element.isConnected || !syncedPanes.has(paneId)) return;
      // A capture of the same content is more faithful than a drawing.
      const captured = () => {
        const kept = savedRef.current?.get(paneId);
        return kept?.source === "capture" && kept.revision === before;
      };
      if (captured()) return;
      const image = await snapshotPanePicture(element);
      if (
        !image ||
        !element.isConnected ||
        !syncedPanes.has(paneId) ||
        revision() !== before ||
        captured()
      )
        return;
      const picture = {
        paneId,
        revision: before,
        image,
        savedAt: Date.now(),
        source: "snapshot" as const,
      };
      keepPicture(picture);
      await savePanePicture(picture);
    },
    [geometryRevision, keepPicture],
  );
  const [snapshots] = useState(createSnapshotQueue);
  useEffect(() => snapshots.setDraw(drawSnapshot), [drawSnapshot, snapshots]);

  return {
    getPanePicture,
    onPanePictureCaptured,
    onLayoutChange,
    pictureFor,
    hasFreshPicture,
    picturesLoaded: saved !== null,
    requestSnapshot: snapshots.request,
    stageRef,
  };
}

// Draws one requested snapshot at a time while the page is idle; a newer
// request for a pane replaces one still waiting.
const SNAPSHOT_INPUT_QUIET_MS = 1000;
const NATIVE_CAPTURE_GRACE_MS = 2000;

export function createSnapshotQueue() {
  type Draw = (paneId: string, element: HTMLElement) => Promise<void>;
  const pending = new Map<string, { element: HTMLElement; after: number }>();
  let draw: Draw | null = null;
  let drawing = false;
  let idle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastInput = 0;
  const noteInput = () => {
    lastInput = performance.now();
  };
  const inputEvents = ["keydown", "pointerdown", "wheel"] as const;
  const next = () => {
    if (drawing || idle !== null || timer !== null || pending.size === 0 || !draw) return;
    const current = draw;
    idle = requestIdleCallback(
      () => {
        idle = null;
        if (draw !== current || pending.size === 0) return;
        // Drawing waits until input has been quiet for a moment.
        const now = performance.now();
        const [paneId, request] = [...pending].reduce((first, candidate) =>
          candidate[1].after < first[1].after ? candidate : first,
        );
        const wait = Math.max(lastInput + SNAPSHOT_INPUT_QUIET_MS, request.after) - now;
        if (wait > 0) {
          timer = setTimeout(() => {
            timer = null;
            next();
          }, wait);
          return;
        }
        pending.delete(paneId);
        drawing = true;
        void current(paneId, request.element)
          .catch(() => {})
          .finally(() => {
            drawing = false;
            next();
          });
      },
      { timeout: 4000 },
    );
  };
  const request: RequestPaneSnapshot = (paneId, element, preferNative = false) => {
    pending.set(paneId, {
      element,
      after: performance.now() + (preferNative ? NATIVE_CAPTURE_GRACE_MS : SNAPSHOT_INPUT_QUIET_MS),
    });
    if (timer !== null) clearTimeout(timer);
    timer = null;
    next();
  };
  const setDraw = (nextDraw: Draw) => {
    draw = nextDraw;
    for (const type of inputEvents) {
      window.addEventListener(type, noteInput, { capture: true, passive: true });
    }
    next();
    return () => {
      if (draw !== nextDraw) return;
      draw = null;
      pending.clear();
      if (idle !== null) cancelIdleCallback(idle);
      if (timer !== null) clearTimeout(timer);
      idle = null;
      timer = null;
      for (const type of inputEvents) {
        window.removeEventListener(type, noteInput, { capture: true });
      }
    };
  };
  return { request, setDraw };
}
