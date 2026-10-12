import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopPanePictureRaster from "../../panePictures/DesktopPanePictureRaster.ts";
import * as Protocol from "../../panePictures/PanePictureProtocol.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const DocumentId = Schema.String.check(Schema.isMaxLength(128));

export const connect = DesktopIpc.makeIpcMethod({
  channel: Protocol.CONNECT,
  payload: DocumentId,
  result: Schema.Boolean,
  handler: (documentId, event) =>
    Effect.gen(function* () {
      if (!event) return false;
      const raster = yield* DesktopPanePictureRaster.DesktopPanePictureRaster;
      return yield* raster.connect(event, documentId);
    }),
});

export const stop = DesktopIpc.makeIpcMethod({
  channel: Protocol.STOP,
  payload: DocumentId,
  result: Schema.Void,
  handler: (documentId, event) =>
    Effect.gen(function* () {
      if (!event) return;
      const raster = yield* DesktopPanePictureRaster.DesktopPanePictureRaster;
      yield* raster.stop(event.sender.id, documentId);
    }),
});

export const scale = DesktopIpc.makeIpcMethod({
  channel: Protocol.SCALE,
  payload: Schema.Struct({ documentId: DocumentId, scale: Schema.Number }),
  result: Schema.Boolean,
  handler: (input, event) =>
    Effect.gen(function* () {
      if (!event) return false;
      const raster = yield* DesktopPanePictureRaster.DesktopPanePictureRaster;
      return yield* raster.scale(event.sender.id, input.documentId, input.scale);
    }),
});
