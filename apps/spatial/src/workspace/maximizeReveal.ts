const MAXIMIZE_REVEAL_MS = 180;

function paneElement(paneId: string) {
  return document.querySelector<HTMLElement>(
    `[data-onirigiri-slot="pane"][data-onirigiri-pane-id="${CSS.escape(paneId)}"]`,
  );
}

/** Opens a pane outward from the box it had before maximizing, whose camera move is instant. */
export function beginMaximizeReveal(paneId: string) {
  const before = paneElement(paneId)?.getBoundingClientRect();
  if (!before || matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  return () => {
    const pane = paneElement(paneId);
    if (!pane) return;
    const after = pane.getBoundingClientRect();
    const inset = [
      before.top - after.top,
      after.right - before.right,
      after.bottom - before.bottom,
      before.left - after.left,
    ]
      .map((edge) => `${Math.max(0, Math.round(edge))}px`)
      .join(" ");
    const radius = getComputedStyle(pane).borderRadius || "0px";
    pane.animate(
      [{ clipPath: `inset(${inset} round ${radius})` }, { clipPath: `inset(0px round ${radius})` }],
      { duration: MAXIMIZE_REVEAL_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  };
}
