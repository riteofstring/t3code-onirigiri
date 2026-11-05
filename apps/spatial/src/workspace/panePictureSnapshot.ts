import { captureOnirigiriPanePicture } from "@riteofstring/onirigiri";

export function hasLivePaneProducer(element: Element): boolean {
  const visit = (node: Element) =>
    node.matches("canvas, video, iframe, object, embed, webview, [data-browser-surface-slot]") ||
    node.localName.includes("-") ||
    node.shadowRoot !== null;
  if (visit(element)) return true;
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
  let child = walker.nextNode();
  while (child) {
    if (visit(child as Element)) return true;
    child = walker.nextNode();
  }
  return false;
}

const SETTLE_TIMEOUT_MS = 1000;

async function settled(element: HTMLElement): Promise<void> {
  const fonts = element.ownerDocument.fonts?.ready;
  const animations =
    typeof element.getAnimations === "function"
      ? element.getAnimations({ subtree: true }).map((animation) => animation.finished)
      : [];
  await Promise.race([
    Promise.allSettled([fonts, ...animations]),
    new Promise((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS)),
  ]);
}

export interface PanePictureSnapshot {
  readonly image: Blob;
  readonly cssSize: { readonly width: number; readonly height: number };
}

export async function snapshotPanePicture(
  element: HTMLElement,
  canSnapshot: () => boolean,
  waitToDraw: () => Promise<boolean>,
  signal: AbortSignal = new AbortController().signal,
): Promise<PanePictureSnapshot | null> {
  if (signal.aborted || !element.isConnected || !canSnapshot() || hasLivePaneProducer(element))
    return null;
  if (!(await waitToDraw()) || signal.aborted || !canSnapshot()) return null;
  await settled(element);
  if (signal.aborted || !element.isConnected || !canSnapshot()) return null;
  const host = element.closest<HTMLElement>(".onirigiri-pane__live-content");
  if (host) host.dataset.spatialSnapshot = "";
  try {
    const picture = await captureOnirigiriPanePicture(element, signal);
    return !signal.aborted && element.isConnected && canSnapshot() ? picture : null;
  } finally {
    if (host) delete host.dataset.spatialSnapshot;
  }
}
