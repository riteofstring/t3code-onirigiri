import type { WorkspaceFocusAnchor } from "@riteofstring/onirigiri";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@t3tools/web/src/components/ui/button";

import { AddPaneButton, FocusAnchorToggle } from "./FocusAnchorToggle";

export function WorkspaceToolbar({
  focusAnchor,
  onAdd,
  onToggleAnchor,
  controlsRef,
}: {
  focusAnchor: WorkspaceFocusAnchor;
  onAdd: () => void;
  onToggleAnchor: () => void;
  controlsRef: (element: HTMLDivElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="spatial-workspace-controls"
      data-spatial-workspace-controls=""
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        triggerRef.current?.focus();
        setOpen(false);
      }}
    >
      <Button
        ref={triggerRef}
        variant="ghost-muted"
        size="icon-sm"
        aria-label="Workspace controls"
        aria-controls={panelId}
        aria-expanded={open}
        title="Workspace controls"
        onClick={() => setOpen((current) => !current)}
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
          <p className="spatial-workspace-controls__hint">
            Ctrl+Alt+arrows to move · Ctrl+Alt+O for overview
          </p>
        </div>
      </div>
    </div>
  );
}
