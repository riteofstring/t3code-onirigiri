export function spatialBrowserOccluders(slot: HTMLElement): HTMLElement[] {
  const stage = slot.closest('[data-onirigiri-slot="stage"]');
  if (!stage) return [];

  const occluders: HTMLElement[] = [];
  for (const child of stage.children) {
    if (child instanceof HTMLElement && child.classList.contains("onirigiri-workspace__minimap")) {
      occluders.push(child);
    }
  }
  return occluders;
}
