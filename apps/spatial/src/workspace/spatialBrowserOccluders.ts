export function spatialBrowserOccluders(slot: HTMLElement): HTMLElement[] {
  const stage = slot.closest('[data-onirigiri-slot="stage"]');
  if (!stage) return [];

  const occluders: HTMLElement[] = [];
  for (const child of stage.children) {
    if (child instanceof HTMLElement && child.classList.contains("onirigiri-workspace__minimap")) {
      occluders.push(child);
    }
  }
  const workspace = stage.closest(".spatial-workspace");
  const controls = workspace?.querySelector(":scope > [data-spatial-workspace-controls]");
  if (controls) {
    for (const child of controls.children) {
      if (child instanceof HTMLElement) occluders.push(child);
    }
  }
  return occluders;
}
