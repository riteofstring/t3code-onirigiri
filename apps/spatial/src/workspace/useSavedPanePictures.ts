import type {
  OnirigiriLayout,
  OnirigiriPanePictureCaptureListener,
  OnirigiriPanePictureResolver,
} from "@riteofstring/onirigiri";
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
export type RequestPaneSnapshot = (paneId: string, element: HTMLElement) => void;

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
  /** The saved picture that still shows the pane as it would look, if any. */
  pictureFor: (paneId: string) => Blob | null;
  requestSnapshot: RequestPaneSnapshot;
  stageRef: (element: HTMLElement | null) => void;
} {
  const threads = useThreadShells();
  const { resolvedTheme } = useTheme();
  const [saved, setSaved] = useState<ReadonlyMap<string, SavedPanePicture> | null>(null);
  const widthsRef = useRef<Map<string, string> | null>(null);
  const stageSizeRef = useRef("");

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
      if (size) stageSizeRef.current = `${Math.round(size.width)}x${Math.round(size.height)}`;
    });
    observer.observe(element);
    stageObserverRef.current = observer;
  }, []);

  const onLayoutChange = useCallback((layout: OnirigiriLayout) => {
    widthsRef.current = columnWidths(layout);
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
  useEffect(() => {
    contentRevisionsRef.current = contentRevisions;
  }, [contentRevisions]);

  const pictureFor = useCallback(
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

  const getPanePicture = useMemo((): OnirigiriPanePictureResolver => {
    return (pane) => {
      const image = pictureFor(pane.paneId);
      return image ? { image, fit: "fill", replaceable: true } : null;
    };
  }, [pictureFor]);

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
      if (!image || revision() !== before || captured()) return;
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
    requestSnapshot: snapshots.request,
    stageRef,
  };
}

// Draws one requested snapshot at a time while the page is idle; a newer
// request for a pane replaces one still waiting.
const SNAPSHOT_INPUT_QUIET_MS = 1000;

function createSnapshotQueue() {
  type Draw = (paneId: string, element: HTMLElement) => Promise<void>;
  const pending = new Map<string, HTMLElement>();
  let draw: Draw | null = null;
  let drawing = false;
  let lastInput = 0;
  const noteInput = () => {
    lastInput = performance.now();
  };
  for (const type of ["keydown", "pointerdown", "wheel"] as const) {
    window.addEventListener(type, noteInput, { capture: true, passive: true });
  }
  const next = () => {
    if (drawing || pending.size === 0 || !draw) return;
    const current = draw;
    drawing = true;
    requestIdleCallback(
      () => {
        // Drawing waits until input has been quiet for a moment.
        const quietFor = performance.now() - lastInput;
        if (quietFor < SNAPSHOT_INPUT_QUIET_MS) {
          setTimeout(() => {
            drawing = false;
            next();
          }, SNAPSHOT_INPUT_QUIET_MS - quietFor);
          return;
        }
        const [paneId, element] = pending.entries().next().value!;
        pending.delete(paneId);
        void current(paneId, element)
          .catch(() => {})
          .finally(() => {
            drawing = false;
            next();
          });
      },
      { timeout: 4000 },
    );
  };
  const request: RequestPaneSnapshot = (paneId, element) => {
    pending.set(paneId, element);
    next();
  };
  const setDraw = (nextDraw: Draw) => {
    draw = nextDraw;
    next();
    return () => {
      if (draw === nextDraw) draw = null;
    };
  };
  return { request, setDraw };
}
