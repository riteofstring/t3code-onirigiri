import type { WorkspaceFocusAnchor } from "@riteofstring/onirigiri";

import { WorkspaceTooltipButton } from "./WorkspaceTooltips";

export function FocusAnchorToggle({
  focusAnchor,
  onToggle,
}: {
  focusAnchor: WorkspaceFocusAnchor;
  onToggle: () => void;
}) {
  const centered = focusAnchor === "center";
  const label = centered ? "Keep the focused pane at the left" : "Center the focused pane";
  const markerX = centered ? "5.5" : "3.5";
  return (
    <WorkspaceTooltipButton aria-label={label} tooltip={label} onClick={onToggle}>
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
        <rect x={markerX} y="5.5" width="5" height="5" fill="currentColor" stroke="none" />
      </svg>
    </WorkspaceTooltipButton>
  );
}
