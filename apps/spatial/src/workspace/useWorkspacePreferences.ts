import { useCallback, useState } from "react";

const STORAGE_KEY = "onirigiri-t3:workspace-preferences";

export const overviewZoomChoices = [
  { value: "auto", label: "Auto", width: undefined },
  { value: "far", label: "Far", width: 160 },
  { value: "medium", label: "Medium", width: 240 },
  { value: "near", label: "Near", width: 320 },
] as const;

export interface WorkspacePreferences {
  overviewZoom: (typeof overviewZoomChoices)[number]["value"];
  rowHeight: number | "viewport";
}

const defaults: WorkspacePreferences = { overviewZoom: "medium", rowHeight: "viewport" };

function readPreferences(): WorkspacePreferences {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return defaults;
    const zoom = "overviewZoom" in value ? value.overviewZoom : null;
    const height = "rowHeight" in value ? value.rowHeight : null;
    return {
      overviewZoom: overviewZoomChoices.find((choice) => choice.value === zoom)?.value ?? "medium",
      rowHeight:
        typeof height === "number" && Number.isSafeInteger(height) && height >= 96
          ? height
          : "viewport",
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
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage can be unavailable; settings still apply to this workspace.
      }
      return next;
    });
  }, []);
  return [preferences, update] as const;
}
