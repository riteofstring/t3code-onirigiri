import type { OnirigiriMinimapPlacement, WorkspaceFocusAnchor } from "@riteofstring/onirigiri";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLayoutMode } from "./useWorkspacePanes";

const STORAGE_KEY = "onirigiri-t3:workspace-preferences";
const FOCUS_ANCHOR_KEY = "onirigiri-t3:focus-anchor";
const LAYOUT_MODE_KEY = "onirigiri-t3:layout-mode";
const MINIMAP_PLACEMENT_KEY = "onirigiri-t3:minimap-placement";
const DEFAULT_MINIMAP_PLACEMENT: OnirigiriMinimapPlacement = {
  corner: "bottom-right",
  widthPx: 220,
  heightPx: 64,
};
export const MIN_COLUMN_WIDTH = 442;
export const DEFAULT_COLUMN_WIDTH = 840;
export const MIN_ROW_HEIGHT = 300;
export const DEFAULT_MAX_ROW_HEIGHT = 1200;

export function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

export const overviewZoomChoices = [
  { value: "auto", label: "Auto", width: undefined },
  { value: "far", label: "Far", width: 160 },
  { value: "medium", label: "Medium", width: 240 },
  { value: "near", label: "Near", width: 320 },
] as const;

export interface WorkspacePreferences {
  overviewZoom: (typeof overviewZoomChoices)[number]["value"];
  rowHeight: number | "viewport";
  maxRowHeight: number;
  columnWidth: number;
  navigationBar: boolean;
  maximizeAll: boolean;
  showGrid: boolean;
  focusOnClick: boolean;
  showMinimap: boolean;
}

const defaults: WorkspacePreferences = {
  overviewZoom: "medium",
  rowHeight: "viewport",
  maxRowHeight: DEFAULT_MAX_ROW_HEIGHT,
  columnWidth: DEFAULT_COLUMN_WIDTH,
  navigationBar: true,
  maximizeAll: false,
  showGrid: false,
  focusOnClick: false,
  showMinimap: true,
};

function readPreferences(): WorkspacePreferences {
  try {
    const value: unknown = JSON.parse(readItem(STORAGE_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return defaults;
    const zoom = "overviewZoom" in value ? value.overviewZoom : null;
    const height = "rowHeight" in value ? value.rowHeight : null;
    const maxHeight = "maxRowHeight" in value ? value.maxRowHeight : null;
    const width = "columnWidth" in value ? value.columnWidth : null;
    const navigationBar = "navigationBar" in value ? value.navigationBar : null;
    const maximizeAll = "maximizeAll" in value ? value.maximizeAll : null;
    const showGrid = "showGrid" in value ? value.showGrid : null;
    const focusOnClick = "focusOnClick" in value ? value.focusOnClick : null;
    const showMinimap = "showMinimap" in value ? value.showMinimap : null;
    return {
      overviewZoom: overviewZoomChoices.find((choice) => choice.value === zoom)?.value ?? "medium",
      rowHeight:
        typeof height === "number" && Number.isSafeInteger(height) && height >= MIN_ROW_HEIGHT
          ? height
          : "viewport",
      maxRowHeight:
        typeof maxHeight === "number" &&
        Number.isSafeInteger(maxHeight) &&
        (maxHeight === 0 || maxHeight >= MIN_ROW_HEIGHT)
          ? maxHeight
          : DEFAULT_MAX_ROW_HEIGHT,
      columnWidth:
        typeof width === "number" && Number.isSafeInteger(width) && width >= MIN_COLUMN_WIDTH
          ? width
          : DEFAULT_COLUMN_WIDTH,
      navigationBar: navigationBar !== false,
      maximizeAll: maximizeAll === true,
      showGrid: showGrid === true,
      focusOnClick: focusOnClick === true,
      showMinimap: showMinimap !== false,
    };
  } catch {
    return defaults;
  }
}

export function useWorkspacePreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  const update = useCallback((change: Partial<WorkspacePreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...change };
      writeItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return [preferences, update] as const;
}

export function useFocusAnchorPreference() {
  const [focusAnchor, setFocusAnchor] = useState<WorkspaceFocusAnchor>(() =>
    readItem(FOCUS_ANCHOR_KEY) === "start" ? "start" : "center",
  );
  const toggle = useCallback(() => {
    setFocusAnchor((current) => {
      const next = current === "center" ? "start" : "center";
      writeItem(FOCUS_ANCHOR_KEY, next);
      return next;
    });
  }, []);
  return [focusAnchor, toggle] as const;
}

export function useLayoutModePreference() {
  const [layoutMode, setLayoutMode] = useState((): WorkspaceLayoutMode => {
    const stored = readItem(LAYOUT_MODE_KEY);
    const requested = new URLSearchParams(window.location.search).get("layout");
    return stored === "strip" || stored === "rows"
      ? stored
      : requested === "strip" || requested === "rows"
        ? requested
        : "rows";
  });
  useEffect(() => writeItem(LAYOUT_MODE_KEY, layoutMode), [layoutMode]);
  return [layoutMode, setLayoutMode] as const;
}

export function useMinimapPlacement() {
  const [placement, setPlacement] = useState((): Partial<OnirigiriMinimapPlacement> => {
    try {
      const value: unknown = JSON.parse(readItem(MINIMAP_PLACEMENT_KEY) ?? "null");
      return typeof value === "object" && value !== null ? value : DEFAULT_MINIMAP_PLACEMENT;
    } catch {
      return DEFAULT_MINIMAP_PLACEMENT;
    }
  });
  const update = useCallback((next: OnirigiriMinimapPlacement) => {
    setPlacement(next);
    writeItem(MINIMAP_PLACEMENT_KEY, JSON.stringify(next));
  }, []);
  return [placement, update] as const;
}
