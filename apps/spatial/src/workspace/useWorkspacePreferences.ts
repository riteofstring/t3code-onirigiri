import type { WorkspaceFocusAnchor } from "@riteofstring/onirigiri";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLayoutMode } from "./useWorkspacePanes";

const STORAGE_KEY = "onirigiri-t3:workspace-preferences";
const FOCUS_ANCHOR_KEY = "onirigiri-t3:focus-anchor";
const LAYOUT_MODE_KEY = "onirigiri-t3:layout-mode";

function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string) {
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
  navigationBar: boolean;
  maximizeAll: boolean;
  showGrid: boolean;
  focusOnClick: boolean;
}

const defaults: WorkspacePreferences = {
  overviewZoom: "medium",
  rowHeight: "viewport",
  navigationBar: false,
  maximizeAll: false,
  showGrid: true,
  focusOnClick: false,
};

function readPreferences(): WorkspacePreferences {
  try {
    const value: unknown = JSON.parse(readItem(STORAGE_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return defaults;
    const zoom = "overviewZoom" in value ? value.overviewZoom : null;
    const height = "rowHeight" in value ? value.rowHeight : null;
    const navigationBar = "navigationBar" in value ? value.navigationBar : null;
    const maximizeAll = "maximizeAll" in value ? value.maximizeAll : null;
    const showGrid = "showGrid" in value ? value.showGrid : null;
    const focusOnClick = "focusOnClick" in value ? value.focusOnClick : null;
    return {
      overviewZoom: overviewZoomChoices.find((choice) => choice.value === zoom)?.value ?? "medium",
      rowHeight:
        typeof height === "number" && Number.isSafeInteger(height) && height >= 96
          ? height
          : "viewport",
      navigationBar: navigationBar === true,
      maximizeAll: maximizeAll === true,
      showGrid: showGrid !== false,
      focusOnClick: focusOnClick === true,
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
