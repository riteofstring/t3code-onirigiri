import { captureOnirigiriPanePicture } from "@riteofstring/onirigiri";

/** The first element in a pane that keeps drawing on its own, which a picture cannot stand in for. */
export function livePaneProducer(element: Element): Element | null {
  const visit = (node: Element) =>
    node.matches("canvas, video, iframe, object, embed, webview, [data-browser-surface-slot]") ||
    node.localName.includes("-") ||
    node.shadowRoot !== null;
  if (visit(element)) return element;
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
  let child = walker.nextNode();
  while (child) {
    if (visit(child as Element)) return child as Element;
    child = walker.nextNode();
  }
  return null;
}

export function hasLivePaneProducer(element: Element): boolean {
  return livePaneProducer(element) !== null;
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
  const host = element.closest<HTMLElement>(".onirigiri-pane__live-content");
  if (host) host.dataset.spatialSnapshot = "";
  const recorded = () => {
    if (host) delete host.dataset.spatialSnapshot;
  };
  try {
    const picture = await captureOnirigiriPanePicture(element, signal, recorded);
    return element.isConnected ? picture : null;
  } finally {
    recorded();
  }
}
