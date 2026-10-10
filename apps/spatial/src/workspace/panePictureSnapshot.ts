/**
 * Pictures of a thread pane drawn from its DOM, for browsers that cannot
 * capture pane content. The pane's markup is cloned into an SVG
 * `foreignObject` with the page's styles and theme variables, rendered as an
 * image and encoded as PNG. Only same-document styles and system fonts are
 * available to the image, which is what T3 uses.
 */

/** Whether the browser lets the workspace capture panes itself (HTML-in-Canvas). */
export function canCapturePanes(): boolean {
  return (
    typeof (CanvasRenderingContext2D.prototype as { drawElementImage?: unknown })
      .drawElementImage === "function"
  );
}

let pageStyles: {
  sheets: { sheet: CSSStyleSheet; disabled: boolean; media: string }[];
  media: { query: MediaQueryList; matches: boolean }[];
  encoded: string;
} | null = null;

// Media conditions belong to the live window, not the smaller SVG viewport.
// Cache their resolved styles until the sheets or matching conditions change.
function encodedPageStyles(): string {
  const sheets = Array.from(document.styleSheets, (sheet) => ({
    sheet,
    disabled: sheet.disabled,
    media: sheet.media.mediaText,
  }));
  if (
    pageStyles !== null &&
    pageStyles.sheets.length === sheets.length &&
    pageStyles.sheets.every((previous, index) => {
      const current = sheets[index]!;
      return (
        previous.sheet === current.sheet &&
        previous.disabled === current.disabled &&
        previous.media === current.media
      );
    }) &&
    pageStyles.media.every(({ query, matches }) => query.matches === matches)
  )
    return pageStyles.encoded;

  const media = new Map<string, { query: MediaQueryList; matches: boolean }>();
  const matches = (condition: string) => {
    let state = media.get(condition);
    if (!state) {
      const query = matchMedia(condition);
      state = { query, matches: query.matches };
      media.set(condition, state);
    }
    return state.matches;
  };
  const rules: string[] = [];
  for (const { sheet, disabled, media: condition } of sheets) {
    if (disabled || (condition && !matches(condition))) continue;
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSImportRule)) rules.push(rule.cssText);
      }
    } catch {
      // Cross-origin sheets cannot be read; T3 serves its own.
    }
  }
  const copy = new CSSStyleSheet();
  copy.replaceSync(rules.join("\n"));
  const resolveMedia = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule) {
        const enabled = matches(rule.conditionText);
        rule.media.mediaText = enabled ? "all" : "not all";
        if (!enabled) continue;
      }
      if ("cssRules" in rule) resolveMedia((rule as CSSGroupingRule).cssRules);
    }
  };
  resolveMedia(copy.cssRules);
  const css = Array.from(copy.cssRules, (rule) => rule.cssText)
    .join("\n")
    .replaceAll("]]>", "]]]]><![CDATA[>");
  pageStyles = {
    sheets,
    media: [...media.values()],
    encoded: encodeURIComponent(`<style><![CDATA[${css}]]></style>`),
  };
  return pageStyles.encoded;
}

// Theme variables and inherited type styles live outside the cloned pane.
function inheritedStyles(element: HTMLElement): string {
  const style = getComputedStyle(element.parentElement ?? element);
  const declarations: string[] = [];
  for (let index = 0; index < style.length; index++) {
    const name = style[index]!;
    if (name.startsWith("--")) declarations.push(`${name}:${style.getPropertyValue(name)}`);
  }
  declarations.push(
    `font-family:${style.fontFamily}`,
    `font-size:${style.fontSize}`,
    `line-height:${style.lineHeight}`,
    `color:${style.color}`,
    `-webkit-font-smoothing:antialiased`,
  );
  return declarations.join(";");
}

// A clone loses scroll offsets; shift the content of scrolled elements instead.
function copyScrollOffsets(source: Element, clone: Element) {
  const sources = [source, ...source.querySelectorAll("*")];
  const clones = [clone, ...clone.querySelectorAll("*")];
  sources.forEach((element, index) => {
    const copy = clones[index];
    if (!(copy instanceof HTMLElement) || (element.scrollTop === 0 && element.scrollLeft === 0)) {
      return;
    }
    copy.style.overflow = "hidden";
    for (const child of copy.children) {
      if (child instanceof HTMLElement || child instanceof SVGElement) {
        child.style.translate = `${-element.scrollLeft}px ${-element.scrollTop}px`;
      }
    }
  });
}

// An image cannot load other resources, so loaded images are inlined.
function inlineImages(source: Element, clone: Element) {
  const sources = source.querySelectorAll("img");
  const clones = clone.querySelectorAll("img");
  sources.forEach((image, index) => {
    const copy = clones[index];
    if (!copy || !image.complete || image.naturalWidth === 0) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      copy.setAttribute("src", canvas.toDataURL());
      copy.removeAttribute("srcset");
    } catch {
      // Cross-origin images stay out of the picture.
    }
  });
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Either handler can retain the encoded SVG after the image source is cleared.
    const onLoad = () => {
      image.removeEventListener("error", onError);
      resolve(image);
    };
    const onError = () => {
      image.removeEventListener("load", onLoad);
      reject(new Error("pane snapshot did not render"));
    };
    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
    image.src = url;
  });
}

/** A PNG after layout settles, or null when the pane is no longer valid or has no size. */
export async function snapshotPanePicture(
  element: HTMLElement,
  canSnapshot: () => boolean,
): Promise<Blob | null> {
  const host = element.closest<HTMLElement>(".onirigiri-pane__live-content");
  if (host) host.dataset.spatialSnapshot = "";
  try {
    // Let hidden content and its resize observers settle before reading its
    // dimensions and scroll offsets. Only this queued capture needs layout.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (!element.isConnected || !canSnapshot()) return null;
    // Drawing clones the live DOM synchronously; encoding no longer needs its layout.
    return drawPanePicture(element);
  } finally {
    if (host) delete host.dataset.spatialSnapshot;
  }
}

async function drawPanePicture(element: HTMLElement): Promise<Blob | null> {
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  if (width === 0 || height === 0) return null;
  const clone = element.cloneNode(true) as HTMLElement;
  copyScrollOffsets(element, clone);
  inlineImages(element, clone);
  for (const node of clone.querySelectorAll("script, iframe, video, canvas")) node.remove();
  // Unsent drafts stay out of saved pictures.
  for (const editor of clone.querySelectorAll('[data-testid="composer-editor"]')) {
    editor.replaceChildren(document.createElement("p"));
  }
  const rootClass = document.documentElement.className;
  const rootFontSize = getComputedStyle(document.documentElement).fontSize;
  const markup = new XMLSerializer().serializeToString(clone);
  // Rem units use the image document's root, independently of the inner content's font size.
  const open =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `style="font-size:${escapeAttribute(rootFontSize)}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="${escapeAttribute(rootClass)}" ` +
    `style="${escapeAttribute(inheritedStyles(element))};width:${width}px;height:${height}px;overflow:hidden">`;
  const close = `</div></foreignObject></svg>`;
  const image = await loadImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(open)}${encodedPageStyles()}` +
      `${encodeURIComponent(markup + close)}`,
  );
  const scale = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  try {
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    image.removeAttribute("src");
  }
}
