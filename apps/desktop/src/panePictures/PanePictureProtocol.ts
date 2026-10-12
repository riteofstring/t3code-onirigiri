import type { DesktopPanePictureRasterInput } from "@t3tools/contracts";

export const CONNECT = "desktop:pane-picture:connect";
export const STOP = "desktop:pane-picture:stop";
export const SCALE = "desktop:pane-picture:scale";
export const PORT = "desktop:pane-picture:port";
export const UNAVAILABLE = "desktop:pane-picture:unavailable";
export const CONNECT_TIMEOUT_MS = 5000;
export const JOB_TIMEOUT_MS = 7000;
export const MAX_INPUT_BYTES = 4 * 1024 * 1024;
export const MAX_PIXEL_BYTES = 32 * 1024 * 1024;
export const MAX_PNG_BYTES = 32 * 1024 * 1024;

export function isRasterInput(value: unknown): value is DesktopPanePictureRasterInput {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Partial<DesktopPanePictureRasterInput>;
  if (
    typeof input.open !== "string" ||
    typeof input.styles !== "string" ||
    typeof input.content !== "string" ||
    typeof input.width !== "number" ||
    typeof input.height !== "number" ||
    typeof input.scale !== "number" ||
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    !Number.isFinite(input.scale) ||
    input.width <= 0 ||
    input.height <= 0 ||
    input.scale < 0.5 ||
    input.scale > 4
  )
    return false;
  const width = Math.round(input.width * input.scale);
  const height = Math.round(input.height * input.scale);
  if (width < 1 || height < 1 || width * height * 4 > MAX_PIXEL_BYTES) return false;
  if (input.open.length + input.styles.length + input.content.length > MAX_INPUT_BYTES)
    return false;
  const encoder = new TextEncoder();
  return (
    [input.open, input.styles, input.content].reduce(
      (bytes, part) => bytes + encoder.encode(part).byteLength,
      0,
    ) <= MAX_INPUT_BYTES
  );
}

export function isPicturePng(buffer: ArrayBuffer, input: DesktopPanePictureRasterInput): boolean {
  if (buffer.byteLength < 45 || buffer.byteLength > MAX_PNG_BYTES) return false;
  const bytes = new Uint8Array(buffer);
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) {
    return false;
  }
  const view = new DataView(buffer);
  return (
    view.getUint32(8) === 13 &&
    view.getUint32(12) === 0x49484452 &&
    view.getUint32(16) === Math.round(input.width * input.scale) &&
    view.getUint32(20) === Math.round(input.height * input.scale) &&
    view.getUint32(buffer.byteLength - 12) === 0 &&
    view.getUint32(buffer.byteLength - 8) === 0x49454e44
  );
}
