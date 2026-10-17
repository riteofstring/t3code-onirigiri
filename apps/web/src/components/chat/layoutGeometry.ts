export function readLayoutScale(element: HTMLElement, rect = element.getBoundingClientRect()) {
  const style = getComputedStyle(element);
  let width = Number.parseFloat(style.width);
  if (style.boxSizing !== "border-box") {
    for (const value of [
      style.paddingLeft,
      style.paddingRight,
      style.borderLeftWidth,
      style.borderRightWidth,
    ]) {
      width += Number.parseFloat(value) || 0;
    }
  }
  if (!(width > 0) || !(rect.width > 0)) return 1;
  const scale = rect.width / width;
  return Math.abs(scale - 1) < 0.000001 ? 1 : scale;
}

export function readLayoutRect(element: HTMLElement, scale?: number) {
  const rect = element.getBoundingClientRect();
  const factor = scale ?? readLayoutScale(element, rect);
  return {
    top: rect.top / factor,
    bottom: rect.bottom / factor,
    left: rect.left / factor,
    right: rect.right / factor,
    width: rect.width / factor,
    height: rect.height / factor,
  };
}
