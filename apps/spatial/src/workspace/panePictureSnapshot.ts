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
  const hidden = () =>
    !!element.closest(
      '[data-spatial-retained-mode="activity"][data-spatial-retained-hidden="true"]',
    );
  if (
    signal.aborted ||
    !element.isConnected ||
    hidden() ||
    !canSnapshot() ||
    hasLivePaneProducer(element)
  )
    return null;
  if (!(await waitToDraw()) || signal.aborted || hidden() || !canSnapshot()) return null;
  const host = element.closest<HTMLElement>(".onirigiri-pane__live-content");
  if (host) host.dataset.spatialSnapshot = "";
  try {
    const picture = await captureOnirigiriPanePicture(element, signal);
    return !signal.aborted && element.isConnected && !hidden() && canSnapshot() ? picture : null;
  } finally {
    if (host) delete host.dataset.spatialSnapshot;
  }
}
