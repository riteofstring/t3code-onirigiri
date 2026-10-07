import type { WorkspaceFocusAnchor } from "@riteofstring/onirigiri";
import { useCallback, useState } from "react";

const STORAGE_KEY = "onirigiri-t3:focus-anchor";

function readFocusAnchor(): WorkspaceFocusAnchor {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "start" ? "start" : "center";
  } catch {
    return "center";
  }
}

/** Where the focused pane rests: centered, or at the workspace's left edge. Remembered. */
export function useFocusAnchorPreference() {
  const [focusAnchor, setFocusAnchor] = useState(readFocusAnchor);
  const toggle = useCallback(() => {
    setFocusAnchor((current) => {
      const next = current === "center" ? "start" : "center";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Unavailable storage only loses the preference across reloads.
      }
      return next;
    });
  }, []);
  return [focusAnchor, toggle] as const;
}

/** A workspace control, styled like Onirigiri's own, that switches the focus anchor. */
export function FocusAnchorToggle({
  focusAnchor,
  onToggle,
}: {
  focusAnchor: WorkspaceFocusAnchor;
  onToggle: () => void;
}) {
  const centered = focusAnchor === "center";
  const label = centered ? "Keep the focused pane at the left" : "Center the focused pane";
  return (
    <div className="onirigiri-workspace__desktop-controls">
      <div className="onirigiri-workspace__toolbar">
        <button
          type="button"
          className="onirigiri-workspace__control"
          data-available="true"
          aria-label={label}
          onClick={onToggle}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
            {centered ? (
              <rect x="5.5" y="5.5" width="5" height="5" fill="currentColor" stroke="none" />
            ) : (
              <rect x="3.5" y="5.5" width="5" height="5" fill="currentColor" stroke="none" />
            )}
          </svg>
        </button>
      </div>
    </div>
  );
}

/** A workspace control that opens a new, empty pane beside the focused one. */
export function AddPaneButton({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="onirigiri-workspace__desktop-controls">
      <div className="onirigiri-workspace__toolbar">
        <button
          type="button"
          className="onirigiri-workspace__control"
          data-available="true"
          aria-label="Add a pane (Option+N)"
          onClick={onAdd}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
