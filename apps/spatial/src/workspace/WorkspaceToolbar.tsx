import {
  formatOnirigiriShortcut,
  getOnirigiriShortcutBindings,
  type OnirigiriShortcutBindings,
  type WorkspaceFocusAnchor,
} from "@riteofstring/onirigiri";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@t3tools/web/src/components/ui/button";

import { AddPaneButton, FocusAnchorToggle } from "./FocusAnchorToggle";

export function WorkspaceToolbar({
  focusAnchor,
  onAdd,
  onToggleAnchor,
  controlsRef,
  shortcuts,
}: {
  focusAnchor: WorkspaceFocusAnchor;
  onAdd: () => void;
  onToggleAnchor: () => void;
  controlsRef: (element: HTMLDivElement | null) => void;
  shortcuts: OnirigiriShortcutBindings;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
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

  // Engine controls arrive through a portal. Listen on their physical parent
  // so hover, Escape and tabbing out behave like the neighboring T3 buttons.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const enter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") setOpen(true);
    };
    const leave = () => {
      if (!container.contains(document.activeElement)) setOpen(false);
    };
    const blur = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !container.contains(event.relatedTarget)) {
        setOpen(false);
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open) return;
      event.preventDefault();
      event.stopPropagation();
      triggerRef.current?.focus();
      setOpen(false);
    };
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.contains(event.target)) {
        setOpen(false);
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
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="spatial-workspace-controls"
      data-spatial-workspace-controls=""
    >
      <Button
        ref={triggerRef}
        variant="ghost-muted"
        size="icon-sm"
        aria-label="Workspace controls"
        aria-controls={panelId}
        aria-expanded={open}
        title={hint ? `Workspace controls\n${hint}` : "Workspace controls"}
        onClick={(event) => {
          const mouse =
            "pointerType" in event.nativeEvent && event.nativeEvent.pointerType === "mouse";
          setOpen((current) => mouse || !current);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <rect x="2" y="2" width="12" height="12" rx="2" strokeWidth="1.5" />
          <path d="M7 2v12M7 8h7" strokeWidth="1.5" />
        </svg>
      </Button>
      <div id={panelId} className="spatial-workspace-controls__popup" hidden={!open}>
        <div className="spatial-workspace-controls__surface">
          <div className="spatial-workspace-controls__actions">
            <AddPaneButton onAdd={onAdd} />
            <FocusAnchorToggle focusAnchor={focusAnchor} onToggle={onToggleAnchor} />
            <div ref={controlsRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
