import {
  formatOnirigiriShortcut,
  getOnirigiriShortcutBindings,
  type OnirigiriShortcutBindings,
  type PaneSizingMode,
  type WorkspaceFocusAnchor,
} from "@riteofstring/onirigiri";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Input } from "@t3tools/web/src/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@t3tools/web/src/components/ui/select";

import { AddPaneButton, FocusAnchorToggle } from "./FocusAnchorToggle";
import { overviewZoomChoices, type WorkspacePreferences } from "./useWorkspacePreferences";
import { WorkspaceTooltipButton as Button } from "./WorkspaceTooltips";

export function WorkspaceToolbar({
  focusAnchor,
  onAdd,
  onToggleAnchor,
  controlsRef,
  shortcuts,
  preferences,
  onPreferencesChange,
  onResizePanes,
}: {
  focusAnchor: WorkspaceFocusAnchor;
  onAdd: () => void;
  onToggleAnchor: () => void;
  controlsRef: (element: HTMLDivElement | null) => void;
  shortcuts: OnirigiriShortcutBindings;
  preferences: WorkspacePreferences;
  onPreferencesChange: (change: Partial<WorkspacePreferences>) => void;
  onResizePanes: (mode: PaneSizingMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const selectOpenRef = useRef(false);
  const selectPopupRef = useRef<HTMLDivElement>(null);
  const mouseHoverRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const focusOnOpenRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const advancedRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const advancedId = useId();
  const moveBinding = getOnirigiriShortcutBindings("focusLeft", shortcuts).find(
    (binding) => binding.whileEditing,
  );
  const overviewBinding = getOnirigiriShortcutBindings("toggleOverview", shortcuts).find(
    (binding) => binding.whileEditing,
  );
  const hint = [
    moveBinding &&
      `${formatOnirigiriShortcut(moveBinding).keys.slice(0, -1).join(" + ")} + arrows to move`,
    overviewBinding && `${formatOnirigiriShortcut(overviewBinding).label} for overview`,
  ]
    .filter(Boolean)
    .join("; ");

  const close = useCallback(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement && containerRef.current?.contains(focused)) {
      focused.blur();
    }
    setOpen(false);
    setAdvanced(false);
    setSelectOpen(false);
    selectOpenRef.current = false;
  }, []);

  useLayoutEffect(() => {
    if (open && focusOnOpenRef.current) {
      focusOnOpenRef.current = false;
      advancedRef.current?.focus();
    }
  }, [open]);

  // Engine controls arrive through a portal. Listen on their physical parent
  // so hover, Escape and tabbing out behave like the neighboring T3 buttons.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const enter = (event: PointerEvent) => {
      mouseHoverRef.current = event.pointerType === "mouse";
      pointerInsideRef.current = true;
      if (event.pointerType === "mouse") setOpen(true);
    };
    const contains = (target: EventTarget | null) =>
      target instanceof Node &&
      (container.contains(target) || selectPopupRef.current?.contains(target));
    const leave = (event: PointerEvent) => {
      pointerInsideRef.current = false;
      if (
        event.pointerType === "mouse" &&
        !selectOpenRef.current &&
        (!contains(document.activeElement) || !document.activeElement?.matches(":focus-visible"))
      )
        close();
    };
    const blur = (event: FocusEvent) => {
      if (event.relatedTarget === null && pointerInsideRef.current) return;
      if (!selectOpenRef.current && !contains(event.relatedTarget)) {
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
  }, [advanced, close, open]);

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
              variant="ghost-muted"
              size="icon-xs"
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
              className="spatial-workspace-controls__reveal"
              data-expanded={advanced}
              aria-hidden={!advanced}
              inert={!advanced}
            >
              <div className="spatial-workspace-controls__advanced">
                <label className="spatial-workspace-controls__field">
                  <span>Overview zoom</span>
                  <Select
                    value={preferences.overviewZoom}
                    items={overviewZoomChoices}
                    open={selectOpen}
                    onOpenChange={(next) => {
                      selectOpenRef.current = next;
                      setSelectOpen(next);
                      if (!next && mouseHoverRef.current && !pointerInsideRef.current) {
                        queueMicrotask(() => {
                          if (!document.activeElement?.matches(":focus-visible")) close();
                        });
                      }
                    }}
                    onValueChange={(value) => {
                      const choice = overviewZoomChoices.find((option) => option.value === value);
                      if (choice) onPreferencesChange({ overviewZoom: choice.value });
                    }}
                  >
                    <SelectTrigger size="compact" aria-label="Overview zoom">
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
                  height={preferences.rowHeight}
                  onChange={(rowHeight) => onPreferencesChange({ rowHeight })}
                />
                <Button
                  variant="ghost-muted"
                  size="icon-xs"
                  aria-label="Maximize all panes"
                  tooltip="Maximize all panes"
                  onClick={() => onResizePanes("full")}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" />
                    <rect x="5" y="5" width="6" height="6" rx="1" />
                  </svg>
                </Button>
                <Button
                  variant="ghost-muted"
                  size="icon-xs"
                  aria-label="Restore default pane sizes"
                  tooltip="Restore all panes to default sizes"
                  onClick={() => onResizePanes("default")}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <rect x="2" y="5" width="9" height="9" rx="1" />
                    <path d="M5 2h8a1 1 0 0 1 1 1v8" />
                  </svg>
                </Button>
              </div>
            </div>
            <AddPaneButton onAdd={onAdd} />
            <FocusAnchorToggle focusAnchor={focusAnchor} onToggle={onToggleAnchor} />
            <div ref={controlsRef} />
          </div>
        </div>
        <Button
          ref={triggerRef}
          variant="ghost-muted"
          size="icon-xs"
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
  onChange,
}: {
  height: WorkspacePreferences["rowHeight"];
  onChange: (height: WorkspacePreferences["rowHeight"]) => void;
}) {
  const text = height === "viewport" ? "" : String(height);
  const [draft, setDraft] = useState({ height, text });
  const cancelBlur = useRef(false);
  if (draft.height !== height) setDraft({ height, text });
  const commit = (input: HTMLInputElement) => {
    if (!input.validity.valid) setDraft({ height, text });
    else if (!input.value) onChange("viewport");
    else if (Number.isSafeInteger(input.valueAsNumber)) onChange(input.valueAsNumber);
    else setDraft({ height, text });
  };
  return (
    <label className="spatial-workspace-controls__field">
      <span>Row height</span>
      <span className="spatial-workspace-controls__height">
        <Input
          nativeInput
          size="compact"
          type="number"
          min={96}
          step={1}
          aria-label="Default row height in pixels"
          aria-description="Blank uses the viewport. Manually resized panes keep their height."
          placeholder="Auto"
          value={draft.text}
          onChange={(event) => setDraft({ height, text: event.target.value })}
          onBlur={(event) => {
            if (cancelBlur.current) cancelBlur.current = false;
            else commit(event.currentTarget);
          }}
          onKeyDownCapture={(event) => {
            if (event.key === "Escape") {
              cancelBlur.current = true;
              setDraft({ height, text });
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.stopPropagation();
            commit(event.currentTarget);
          }}
        />
      </span>
      <span>px</span>
    </label>
  );
}
