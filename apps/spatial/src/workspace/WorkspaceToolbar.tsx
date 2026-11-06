import {
  formatOnirigiriShortcut,
  getOnirigiriShortcutBindings,
  type OnirigiriShortcutBindings,
  type WorkspaceFocusAnchor,
} from "@riteofstring/onirigiri";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@t3tools/web/src/components/ui/select";

import { AddPaneButton, FocusAnchorToggle } from "./FocusAnchorToggle";
import {
  MIN_COLUMN_WIDTH,
  overviewZoomChoices,
  type WorkspacePreferences,
} from "./useWorkspacePreferences";
import { WorkspaceTooltipButton as Button } from "./WorkspaceTooltips";

export function WorkspaceToolbar({
  focusAnchor,
  onAdd,
  onToggleAnchor,
  controlsRef,
  shortcuts,
  preferences,
  focusedRowHeight,
  maxRowHeight,
  maxColumnWidth,
  onPreferencesChange,
  layoutMode,
  onLayoutModeChange,
}: {
  focusAnchor: WorkspaceFocusAnchor;
  onAdd: () => void;
  onToggleAnchor: () => void;
  controlsRef: (element: HTMLDivElement | null) => void;
  shortcuts: OnirigiriShortcutBindings;
  preferences: WorkspacePreferences;
  focusedRowHeight: number | null;
  maxRowHeight: number | null;
  maxColumnWidth: number | null;
  onPreferencesChange: (change: Partial<WorkspacePreferences>) => void;
  layoutMode: "strip" | "rows";
  onLayoutModeChange: (mode: "strip" | "rows") => void;
}) {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const selectOpenRef = useRef(false);
  const selectPopupRef = useRef<HTMLDivElement>(null);
  const mouseHoverRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusOnOpenRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const advancedRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const advancedId = useId();
  const focusBinding = getOnirigiriShortcutBindings("focusLeft", shortcuts).find(
    (binding) => binding.key === "ArrowLeft",
  );
  const moveBinding = getOnirigiriShortcutBindings("movePaneLeft", shortcuts).find(
    (binding) => binding.key === "ArrowLeft",
  );
  const editingFocusBinding = getOnirigiriShortcutBindings("focusLeft", shortcuts).find(
    (binding) => binding.key === "ArrowLeft" && binding.shiftKey,
  );
  const overviewBinding = getOnirigiriShortcutBindings("toggleOverview", shortcuts).find(
    (binding) => binding.whileEditing && !binding.ctrlKey,
  );
  const hint = [
    focusBinding &&
      `${formatOnirigiriShortcut(focusBinding).keys.slice(0, -1).join(" + ")} + arrows to navigate (in the composer, at the text edge)`,
    editingFocusBinding &&
      `${formatOnirigiriShortcut(editingFocusBinding).keys.slice(0, -1).join(" + ")} + arrows while typing (with no selection)`,
    moveBinding &&
      `${formatOnirigiriShortcut(moveBinding).keys.slice(0, -1).join(" + ")} + arrows to move panes`,
    overviewBinding && `${formatOnirigiriShortcut(overviewBinding).label} for overview`,
  ]
    .filter(Boolean)
    .join("; ");

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current === null) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const close = useCallback(() => {
    cancelClose();
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement && containerRef.current?.contains(focused)) {
      focused.blur();
    }
    setOpen(false);
    setSelectOpen(false);
    selectOpenRef.current = false;
  }, [cancelClose]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (pointerInsideRef.current || selectOpenRef.current) return;
      const focused = document.activeElement;
      if (
        focused &&
        (containerRef.current?.contains(focused) || selectPopupRef.current?.contains(focused)) &&
        focused.matches(":focus-visible")
      )
        return;
      close();
    }, 600);
  }, [cancelClose, close]);

  useEffect(() => cancelClose, [cancelClose]);

  useLayoutEffect(() => {
    if (open && focusOnOpenRef.current) {
      focusOnOpenRef.current = false;
      advancedRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const enter = (event: PointerEvent) => {
      cancelClose();
      mouseHoverRef.current = event.pointerType === "mouse";
      pointerInsideRef.current = true;
      if (event.pointerType === "mouse") setOpen(true);
    };
    const contains = (target: EventTarget | null) =>
      target instanceof Node &&
      (container.contains(target) || selectPopupRef.current?.contains(target));
    const leave = (event: PointerEvent) => {
      pointerInsideRef.current = false;
      if (event.pointerType === "mouse") scheduleClose();
    };
    const blur = (event: FocusEvent) => {
      if (pointerInsideRef.current && (mouseHoverRef.current || event.relatedTarget === null))
        return;
      if (
        closeTimerRef.current === null &&
        !selectOpenRef.current &&
        !contains(event.relatedTarget)
      ) {
        close();
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open || selectOpenRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (advanced) {
        advancedRef.current?.focus();
        setAdvanced(false);
      } else {
        triggerRef.current?.focus();
        close();
      }
    };
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !contains(event.target)) {
        close();
      }
    };
    container.addEventListener("pointerenter", enter);
    container.addEventListener("pointerleave", leave);
    container.addEventListener("focusout", blur);
    container.addEventListener("keydown", keyDown);
    if (open) document.addEventListener("pointerdown", dismiss, true);
    return () => {
      container.removeEventListener("pointerenter", enter);
      container.removeEventListener("pointerleave", leave);
      container.removeEventListener("focusout", blur);
      container.removeEventListener("keydown", keyDown);
      document.removeEventListener("pointerdown", dismiss, true);
    };
  }, [advanced, cancelClose, close, open, scheduleClose]);

  return (
    <div
      ref={containerRef}
      className="spatial-workspace-controls"
      data-spatial-workspace-controls=""
    >
      <div className="spatial-workspace-controls__surface" data-expanded={open}>
        <div
          id={panelId}
          className="spatial-workspace-controls__reveal"
          data-expanded={open}
          aria-hidden={!open}
          inert={!open}
        >
          <div className="spatial-workspace-controls__actions">
            <Button
              ref={advancedRef}
              aria-label="Advanced workspace controls"
              aria-controls={advancedId}
              aria-expanded={advanced}
              tooltip="Advanced workspace controls"
              onClick={() => setAdvanced(!advanced)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M2 4h12M2 8h12M2 12h12" />
                <path d="M5 2v4M11 6v4M7 10v4" strokeWidth="3" />
              </svg>
            </Button>
            <div
              id={advancedId}
              className="spatial-workspace-controls__reveal spatial-workspace-controls__settings"
              data-expanded={advanced}
              aria-hidden={!advanced}
              inert={!advanced}
            >
              <div className="spatial-workspace-controls__advanced">
                <label
                  className="spatial-workspace-controls__field"
                  title="How large panes appear in overview."
                >
                  <span>Overview zoom</span>
                  <Select
                    value={preferences.overviewZoom}
                    items={overviewZoomChoices}
                    open={selectOpen}
                    onOpenChange={(next) => {
                      selectOpenRef.current = next;
                      setSelectOpen(next);
                      if (next) cancelClose();
                      else if (mouseHoverRef.current && !pointerInsideRef.current) scheduleClose();
                    }}
                    onValueChange={(value) => {
                      const choice = overviewZoomChoices.find((option) => option.value === value);
                      if (choice) onPreferencesChange({ overviewZoom: choice.value });
                    }}
                  >
                    <SelectTrigger size="compact" className="text-xs" aria-label="Overview zoom">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup ref={selectPopupRef} side="top" alignItemWithTrigger={false}>
                      {overviewZoomChoices.map((choice) => (
                        <SelectItem key={choice.value} value={choice.value}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </label>
                <RowHeightControl
                  height={
                    preferences.maximizeAll
                      ? "viewport"
                      : (focusedRowHeight ?? preferences.rowHeight)
                  }
                  maximum={maxRowHeight}
                  onChange={(rowHeight) => onPreferencesChange({ rowHeight, maximizeAll: false })}
                />
                <ColumnWidthControl
                  width={preferences.columnWidth}
                  maximum={maxColumnWidth}
                  onChange={(columnWidth) =>
                    onPreferencesChange({ columnWidth, maximizeAll: false })
                  }
                />
              </div>
            </div>
            <AddPaneButton onAdd={onAdd} />
            <Button
              aria-label="Full screen panes"
              aria-pressed={preferences.maximizeAll}
              tooltip="Full screen panes"
              onClick={() => onPreferencesChange({ maximizeAll: !preferences.maximizeAll })}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                {preferences.maximizeAll ? (
                  <>
                    <rect x="2" y="5" width="9" height="9" rx="1" />
                    <path d="M5 2h8a1 1 0 0 1 1 1v8" />
                  </>
                ) : (
                  <>
                    <path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" />
                    <rect x="5" y="5" width="6" height="6" rx="1" />
                  </>
                )}
              </svg>
            </Button>
            <Button
              aria-label="Minimap"
              aria-pressed={preferences.showMinimap}
              tooltip={preferences.showMinimap ? "Hide minimap" : "Show minimap"}
              onClick={() => onPreferencesChange({ showMinimap: !preferences.showMinimap })}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
                <rect x="8" y="8" width="4.5" height="3.5" rx="0.5" />
              </svg>
            </Button>
            <Button
              aria-label={preferences.showGrid ? "Hide grid" : "Show grid"}
              aria-pressed={preferences.showGrid}
              tooltip={
                preferences.showGrid
                  ? "Hide the empty pane slots"
                  : "Show the empty pane slots around your panes"
              }
              onClick={() => onPreferencesChange({ showGrid: !preferences.showGrid })}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="2 1.5"
              >
                <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
                <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
                <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
                <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
              </svg>
            </Button>
            <Button
              aria-label={preferences.navigationBar ? "Hide navigation bar" : "Show navigation bar"}
              aria-pressed={preferences.navigationBar}
              tooltip={
                preferences.navigationBar
                  ? "Hide the navigation bar"
                  : "Show the navigation bar along the bottom"
              }
              onClick={() => onPreferencesChange({ navigationBar: !preferences.navigationBar })}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="2" y="2" width="12" height="12" rx="1.5" />
                <path d="M2 10.5h12M6 12.5h4" />
              </svg>
            </Button>
            <Button
              aria-label={preferences.focusOnClick ? "Keep focus on click" : "Focus pane on click"}
              aria-pressed={preferences.focusOnClick}
              tooltip={
                preferences.focusOnClick
                  ? "Clicking a pane focuses it and brings it into view"
                  : "Clicking a pane leaves the focus ring and view where they are"
              }
              onClick={() => onPreferencesChange({ focusOnClick: !preferences.focusOnClick })}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              >
                <path d="M7 1.5H2.5a1 1 0 0 0-1 1V7M14.5 7V2.5a1 1 0 0 0-1-1H9M1.5 9v4.5a1 1 0 0 0 1 1H7" />
                <path d="M9 9l5.5 2-2.5 1-1 2.5z" />
              </svg>
            </Button>
            <span className="spatial-workspace-controls__divider" aria-hidden="true" />
            <Button
              aria-label={layoutMode === "strip" ? "Switch to 2D layout" : "Switch to strip layout"}
              tooltip={
                layoutMode === "strip"
                  ? "Switch to the 2D layout: one row per project"
                  : "Switch to the strip layout: every thread in one row"
              }
              onClick={() => onLayoutModeChange(layoutMode === "strip" ? "rows" : "strip")}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                {layoutMode === "strip" ? (
                  <>
                    <rect x="1.5" y="2" width="7" height="4.5" rx="1" />
                    <rect x="11" y="2" width="3.5" height="4.5" rx="1" />
                    <rect x="1.5" y="9.5" width="3.5" height="4.5" rx="1" />
                    <rect x="7.5" y="9.5" width="7" height="4.5" rx="1" />
                  </>
                ) : (
                  <>
                    <rect x="1" y="4.5" width="3" height="7" rx="1" />
                    <rect x="6.5" y="4.5" width="3" height="7" rx="1" />
                    <rect x="12" y="4.5" width="3" height="7" rx="1" />
                  </>
                )}
              </svg>
            </Button>
            <span className="spatial-workspace-controls__divider" aria-hidden="true" />
            <FocusAnchorToggle focusAnchor={focusAnchor} onToggle={onToggleAnchor} />
            <div ref={controlsRef} />
          </div>
        </div>
        <Button
          ref={triggerRef}
          size="icon"
          aria-label="Workspace controls"
          aria-controls={panelId}
          aria-expanded={open}
          tooltip={hint ? `Workspace controls · ${hint}` : "Workspace controls"}
          onClick={(event) => {
            if (event.detail > 0 && mouseHoverRef.current) {
              setOpen(true);
              return;
            }
            if (open) close();
            else {
              focusOnOpenRef.current = event.detail === 0;
              setOpen(true);
            }
          }}
        >
          <OnirigiriMark />
        </Button>
      </div>
    </div>
  );
}

function OnirigiriMark() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.4 4.5a3 3 0 0 1 5.2 0l6 10.5a3 3 0 0 1-2.6 4.5H6A3 3 0 0 1 3.4 15Z" />
      <path d="M9 19.5v-5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5" />
    </svg>
  );
}

function RowHeightControl({
  height,
  maximum,
  onChange,
}: {
  height: WorkspacePreferences["rowHeight"];
  maximum: number | null;
  onChange: (height: WorkspacePreferences["rowHeight"]) => void;
}) {
  const max = maximum ?? 96;
  const min = Math.min(96, max);
  const value = Math.max(min, Math.min(max, height === "viewport" ? max : height));
  const progress = max === min ? 100 : ((value - min) / (max - min)) * 100;
  return (
    <label
      className="spatial-workspace-controls__field"
      title="Shows the focused row. Changing it sets every row."
    >
      <span>Row height</span>
      <span className="spatial-workspace-controls__height">
        <input
          className="settings-slider w-full"
          type="range"
          min={min}
          max={max}
          step={1}
          disabled={maximum === null || min === max}
          aria-label="Row height in pixels"
          aria-description="Applies to all rows and leaves full screen panes. The maximum follows the view height."
          aria-valuetext={value === max ? "Full view height" : `${value} pixels`}
          value={value}
          style={
            {
              "--settings-slider-progress": `${progress}%`,
              "--settings-slider-fill-offset": `${0.5 - progress / 100}rem`,
            } as CSSProperties
          }
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (next !== value) onChange(next === max ? "viewport" : next);
          }}
        />
      </span>
      <span className="spatial-workspace-controls__height-value" aria-hidden="true">
        {value === max ? "Full view" : `${value}px`}
      </span>
    </label>
  );
}

function ColumnWidthControl({
  width,
  maximum,
  onChange,
}: {
  width: number;
  maximum: number | null;
  onChange: (width: number) => void;
}) {
  const max = Math.max(MIN_COLUMN_WIDTH, maximum ?? MIN_COLUMN_WIDTH);
  const value = Math.max(MIN_COLUMN_WIDTH, Math.min(max, width));
  const progress =
    max === MIN_COLUMN_WIDTH ? 100 : ((value - MIN_COLUMN_WIDTH) / (max - MIN_COLUMN_WIDTH)) * 100;
  return (
    <label className="spatial-workspace-controls__field" title="Sets the width of every column.">
      <span>Column width</span>
      <span className="spatial-workspace-controls__height">
        <input
          className="settings-slider w-full"
          type="range"
          min={MIN_COLUMN_WIDTH}
          max={max}
          step={1}
          disabled={maximum === null || max === MIN_COLUMN_WIDTH}
          aria-label="Column width in pixels"
          aria-description="Applies to all columns and leaves full screen panes. The maximum is half the view width."
          aria-valuetext={`${value} pixels`}
          value={value}
          style={
            {
              "--settings-slider-progress": `${progress}%`,
              "--settings-slider-fill-offset": `${0.5 - progress / 100}rem`,
            } as CSSProperties
          }
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (next !== value) onChange(next);
          }}
        />
      </span>
      <span className="spatial-workspace-controls__height-value" aria-hidden="true">
        {`${value}px`}
      </span>
    </label>
  );
}
