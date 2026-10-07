import { useOnirigiriPaneInteractive } from "@riteofstring/onirigiri";
import { useEffect, useRef } from "react";

import { Button } from "@t3tools/web/src/components/ui/button";

/** A new pane that shows nothing yet: the user picks what it becomes. */
export function EmptyPane({
  threadTitle,
  focused,
  onChoose,
  onClose,
}: {
  threadTitle: string;
  focused: boolean;
  onChoose: (kind: "terminal" | "diff") => void;
  onClose: () => void;
}) {
  // The focused new pane takes keyboard focus on its first choice once it
  // accepts input.
  const interactive = useOnirigiriPaneInteractive();
  const choicesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused && interactive) {
      choicesRef.current?.querySelector("button")?.focus({ preventScroll: true });
    }
  }, [focused, interactive]);
  return (
    <div
      role="group"
      aria-label={`New pane for ${threadTitle}`}
      className="flex h-full w-full flex-col items-center justify-center gap-4 bg-background p-6 text-foreground"
    >
      <div className="text-center">
        <p className="text-sm font-medium">What should this pane show?</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">For {threadTitle}</p>
      </div>
      <div ref={choicesRef} className="flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onChoose("terminal")}>
          Terminal
        </Button>
        <Button size="sm" variant="outline" onClick={() => onChoose("diff")}>
          Diff
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
