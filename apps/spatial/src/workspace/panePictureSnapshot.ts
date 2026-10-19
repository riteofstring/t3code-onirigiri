export function canCapturePanes(): boolean {
  return (
    typeof (CanvasRenderingContext2D.prototype as { drawElementImage?: unknown })
      .drawElementImage === "function"
  );
}

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

const TEXT_SAMPLE_ROWS = 10;
const TEXT_PIXEL_TOLERANCE = 1.25;

let textLayout: {
  key: string;
  height: number;
  width: number;
  scale: number;
  geometric: boolean;
} | null = null;

function fontStyles(style: CSSStyleDeclaration): string {
  return [
    `font:${style.font}`,
    `letter-spacing:${style.letterSpacing}`,
    `word-spacing:${style.wordSpacing}`,
    `font-feature-settings:${style.fontFeatureSettings}`,
    `font-variation-settings:${style.fontVariationSettings}`,
    `font-kerning:${style.fontKerning}`,
    `font-optical-sizing:${style.fontOpticalSizing}`,
  ].join(";");
}

async function matchTextLayout(
  source: HTMLElement,
  clone: HTMLElement,
  canSnapshot: () => boolean,
): Promise<void> {
  const code = source.querySelector(".chat-markdown :is(p,li) > code");
  const prose = code?.closest(".chat-markdown");
  if (!code || !prose) return;
  const proseStyle = getComputedStyle(prose);
  const codeStyle = getComputedStyle(code);
  if (
    !proseStyle.font ||
    !codeStyle.font ||
    proseStyle.textRendering !== "auto" ||
    codeStyle.textRendering !== "auto"
  )
    return;
  const strong = prose.querySelector("strong");
  const strongStyle = strong ? getComputedStyle(strong) : null;
  if (strongStyle && (!strongStyle.font || strongStyle.textRendering !== "auto")) return;
  const proseFont = fontStyles(proseStyle);
  const codeFont = fontStyles(codeStyle);
  const strongFont = strongStyle ? fontStyles(strongStyle) : "";
  const key = [proseFont, codeFont, codeStyle.padding, codeStyle.borderWidth, strongFont].join(";");
  const copies = [...clone.querySelectorAll<HTMLElement>(".chat-markdown")];
  const matching = [...source.querySelectorAll(".chat-markdown")].flatMap((element, index) => {
    const style = getComputedStyle(element);
    return style.textRendering === "auto" && fontStyles(style) === proseFont && copies[index]
      ? [copies[index]!]
      : [];
  });
  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText =
    "all:initial;position:fixed;left:-10000px;top:0;visibility:hidden;contain:strict;width:300px;height:1px";
  const sample = document.createElement("div");
  sample.style.cssText = `all:initial;display:block;text-rendering:inherit;width:300px;${proseFont};white-space:nowrap;color:black;background:white`;
  const end = document.createElement("span");
  end.style.cssText =
    "all:initial;display:inline-block;width:3px;height:3px;background:rgb(21,87,173)";
  for (let index = 0; index < TEXT_SAMPLE_ROWS; index++) {
    const row = document.createElement("div");
    row.style.cssText = "all:unset;display:block";
    const inlineCode = document.createElement("span");
    inlineCode.style.cssText = `all:unset;${codeFont};padding:${codeStyle.padding};border-style:solid;border-width:${codeStyle.borderWidth}`;
    inlineCode.textContent = "Bp";
    row.append("Ag", inlineCode);
    if (strongStyle) {
      const bold = document.createElement("span");
      bold.style.cssText = `all:unset;${strongFont}`;
      bold.textContent = "Cm";
      row.append(bold);
    }
    if (index === 0) row.append(end);
    sample.append(row);
  }
  const marker = document.createElement("div");
  marker.style.cssText = "all:initial;display:block;width:3px;height:3px;background:rgb(161,35,69)";
  sample.append(marker);
  holder.append(sample);
  document.body.append(holder);
  const scale = window.devicePixelRatio || 1;
  let height: number;
  let width: number;
  try {
    const rect = sample.getBoundingClientRect();
    height = (marker.getBoundingClientRect().y - rect.y) * scale;
    width = (end.getBoundingClientRect().x - rect.x) * scale;
  } finally {
    holder.remove();
  }
  if (
    !textLayout ||
    textLayout.key !== key ||
    textLayout.height !== height ||
    textLayout.width !== width ||
    textLayout.scale !== scale
  ) {
    const markup = new XMLSerializer().serializeToString(sample);
    const errors: number[] = [];
    const imageHeight = Math.ceil(height / scale + 32);
    try {
      for (const rendering of ["auto", "geometricPrecision"]) {
        if (!canSnapshot()) return;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="${imageHeight}" style="text-rendering:${rendering}"><foreignObject width="300" height="${imageHeight}">${markup}</foreignObject></svg>`;
        const image = await loadImage(
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        );
        const canvas = document.createElement("canvas");
        try {
          if (!canSnapshot()) return;
          canvas.width = Math.ceil(300 * scale);
          canvas.height = Math.ceil(imageHeight * scale);
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return;
          context.scale(scale, scale);
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let imageY = Number.NaN;
          let imageX = Number.NaN;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (
              Number.isNaN(imageY) &&
              pixels[offset] === 161 &&
              pixels[offset + 1] === 35 &&
              pixels[offset + 2] === 69
            )
              imageY = Math.floor(offset / 4 / canvas.width);
            if (
              Number.isNaN(imageX) &&
              pixels[offset] === 21 &&
              pixels[offset + 1] === 87 &&
              pixels[offset + 2] === 173
            )
              imageX = (offset / 4) % canvas.width;
            if (!Number.isNaN(imageY) && !Number.isNaN(imageX)) break;
          }
          errors.push(Math.max(Math.abs(imageY - height), Math.abs(imageX - width)));
        } finally {
          canvas.width = canvas.height = 0;
          image.removeAttribute("src");
        }
      }
    } catch {
      return;
    }
    textLayout = {
      key,
      height,
      width,
      scale,
      geometric: errors[0]! > TEXT_PIXEL_TOLERANCE && errors[1]! <= TEXT_PIXEL_TOLERANCE,
    };
  }
  if (textLayout.geometric) {
    for (const markdown of matching) markdown.style.textRendering = "geometricPrecision";
  }
}

let pageStyles: {
  sheets: { sheet: CSSStyleSheet; disabled: boolean; media: string }[];
  media: { query: MediaQueryList; matches: boolean }[];
  encoded: string;
} | null = null;

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
    } catch {}
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
    `color-scheme:${style.colorScheme}`,
    `tab-size:${style.tabSize}`,
    `text-rendering:${style.textRendering}`,
    `-webkit-font-smoothing:${style.getPropertyValue("-webkit-font-smoothing")}`,
  );
  return declarations.join(";");
}

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
    } catch {}
  });
}

function copySvgReferences(source: Element, clone: Element): SVGDefsElement {
  const references = [...clone.querySelectorAll("use")];
  const visited = new Set<string>();
  const definitions = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  for (const reference of references) {
    const href = reference.getAttribute("href") ?? reference.getAttribute("xlink:href");
    if (!href?.startsWith("#") || href.length === 1) continue;
    const id = href.slice(1);
    if (visited.has(id)) continue;
    visited.add(id);
    const selector = `#${CSS.escape(id)}`;
    if (clone.id === id || clone.querySelector(selector) || definitions.querySelector(selector)) {
      continue;
    }
    const target = source.ownerDocument.getElementById(id);
    if (!(target instanceof SVGElement)) continue;
    const copy = target.cloneNode(true) as SVGElement;
    definitions.append(copy);
    if (copy instanceof SVGUseElement) references.push(copy);
    references.push(...copy.querySelectorAll("use"));
  }
  return definitions;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
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

export interface PanePictureSnapshot {
  readonly image: Blob;
  readonly cssSize: { readonly width: number; readonly height: number };
}

export async function snapshotPanePicture(
  element: HTMLElement,
  canSnapshot: () => boolean,
  waitToDraw: () => Promise<boolean>,
): Promise<PanePictureSnapshot | null> {
  const host = element.closest<HTMLElement>(".onirigiri-pane__live-content");
  if (host) host.dataset.spatialSnapshot = "";
  try {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (!element.isConnected || !canSnapshot() || hasLivePaneProducer(element)) return null;
    return drawPanePicture(element, canSnapshot, waitToDraw);
  } finally {
    if (host) delete host.dataset.spatialSnapshot;
  }
}

async function drawPanePicture(
  element: HTMLElement,
  canSnapshot: () => boolean,
  waitToDraw: () => Promise<boolean>,
): Promise<PanePictureSnapshot | null> {
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  if (width === 0 || height === 0) return null;
  const clone = element.cloneNode(true) as HTMLElement;
  copyScrollOffsets(element, clone);
  inlineImages(element, clone);
  const definitions = copySvgReferences(element, clone);
  for (const root of [clone, definitions]) {
    for (const node of root.querySelectorAll("script, iframe, video, canvas")) node.remove();
    for (const editor of root.querySelectorAll('[data-testid="composer-editor"]')) {
      editor.replaceChildren(document.createElement("p"));
    }
  }
  const wrapper = document.documentElement.cloneNode(false) as HTMLElement;
  wrapper.style.cssText = `${inheritedStyles(element)};width:${width}px;height:${height}px;overflow:hidden`;
  wrapper.append(clone);
  const rootFontSize = getComputedStyle(document.documentElement).fontSize;
  const styles = encodedPageStyles();
  await matchTextLayout(element, clone, canSnapshot);
  if (!element.isConnected || !canSnapshot()) return null;
  const markup = new XMLSerializer().serializeToString(wrapper);
  const open =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `style="font-size:${escapeAttribute(rootFontSize)}">` +
    new XMLSerializer().serializeToString(definitions) +
    `<foreignObject width="100%" height="100%">`;
  const close = `</foreignObject></svg>`;
  const rasterize = window.desktopBridge?.rasterizePanePicture;
  if (rasterize) {
    if (!(await waitToDraw())) return null;
    try {
      const pixels = await rasterize({
        open,
        styles,
        content: markup + close,
        width,
        height,
        scale: window.devicePixelRatio || 1,
      });
      if (pixels?.byteLength) {
        return {
          image: new Blob([pixels], { type: "image/png" }),
          cssSize: { width, height },
        };
      }
    } catch {}
  }
  const image = await loadImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(open)}${styles}` +
      `${encodeURIComponent(markup + close)}`,
  );
  const scale = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  try {
    if (!(await waitToDraw())) return null;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? { image: blob, cssSize: { width, height } } : null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    image.removeAttribute("src");
  }
}
