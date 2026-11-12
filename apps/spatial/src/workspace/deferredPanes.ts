const DEFERRED = "data-spatial-deferred";
const PANE = '[data-onirigiri-slot="pane"]';
// Only chats are held: they have a picture to show meanwhile, other panes would be blank.
const CHAT = `${PANE}[data-onirigiri-pane-id^="thread:"]`;

/** Holds every chat but the focused one unrendered, so a layout switch resizes one chat at once. */
export function deferOtherPanes(root: HTMLElement | null) {
  for (const pane of root?.querySelectorAll<HTMLElement>(CHAT) ?? [])
    if (pane.dataset.focused !== "true") pane.setAttribute(DEFERRED, "");
}

/** Renders held panes again one per idle period at rest, nearest the focused pane first. */
export function releaseDeferredPanes(
  root: HTMLElement | null,
  isMoving: () => boolean = () => false,
): () => void {
  const held = [...(root?.querySelectorAll<HTMLElement>(`${PANE}[${DEFERRED}]`) ?? [])];
  if (held.length === 0) return () => {};
  const centre = (pane: Element) => {
    const box = pane.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };
  const focused = root?.querySelector(`${PANE}[data-focused="true"]`);
  const origin = focused ? centre(focused) : { x: 0, y: 0 };
  const distance = new Map(
    held.map((pane) => {
      const { x, y } = centre(pane);
      return [pane, Math.hypot(x - origin.x, y - origin.y)];
    }),
  );
  held.sort((a, b) => distance.get(a)! - distance.get(b)!);
  let idle: number | null = null;
  const next = () => {
    if (!isMoving()) held.shift()?.removeAttribute(DEFERRED);
    idle = held.length > 0 ? requestIdleCallback(next, { timeout: 1000 }) : null;
  };
  idle = requestIdleCallback(next, { timeout: 1000 });
  // The layout is changing again: every pane it shows must be live, so nothing stays held.
  return () => {
    if (idle !== null) cancelIdleCallback(idle);
    for (const pane of held) pane.removeAttribute(DEFERRED);
  };
}

export function isDeferredPane(element: Element): boolean {
  return (element.closest?.(`[${DEFERRED}]`) ?? null) !== null;
}
