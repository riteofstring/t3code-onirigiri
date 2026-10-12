import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import type { DesktopIpcInvokeEvent } from "../ipc/DesktopIpc.ts";
import { createPanePictureRaster } from "./PanePictureRaster.ts";

export class DesktopPanePictureRaster extends Context.Service<
  DesktopPanePictureRaster,
  {
    readonly connect: (event: DesktopIpcInvokeEvent, documentId: string) => Effect.Effect<boolean>;
    readonly stop: (senderId: number, documentId: string) => Effect.Effect<void>;
    readonly scale: (senderId: number, documentId: string, scale: number) => Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/panePictures/DesktopPanePictureRaster") {}

export const make = Effect.gen(function* () {
  const windows = yield* ElectronWindow.ElectronWindow;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const runPromise = Effect.runPromiseWith(yield* Effect.context());
  let current: { ownerId: number; service: ReturnType<typeof createPanePictureRaster> } | undefined;
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      await current?.service.dispose();
    }),
  );
  return DesktopPanePictureRaster.of({
    connect: (event, documentId) =>
      Effect.gen(function* () {
        const main = yield* windows.main;
        const senderId = event.sender.id;
        if (Option.isNone(main) || main.value.webContents.id !== senderId) return false;
        const owner = main.value.webContents;
        const isCurrentDocument = () => {
          const frame = event.senderFrame;
          return !!frame && !frame.detached && !owner.isDestroyed() && frame === owner.mainFrame;
        };
        if (!isCurrentDocument()) return false;
        if (current?.ownerId !== senderId) {
          yield* Effect.promise(async () => {
            await current?.service.dispose();
          });
          current = {
            ownerId: senderId,
            service: createPanePictureRaster(
              main.value,
              (options) => runPromise(windows.create(options)),
              environment.path.join(environment.dirname, "pane-picture-preload.cjs"),
            ),
          };
        }
        return yield* Effect.promise(() => current!.service.connect(documentId, isCurrentDocument));
      }),
    stop: (senderId, documentId) =>
      Effect.promise(async () => {
        if (current?.ownerId === senderId) await current.service.stop(documentId);
      }),
    scale: (senderId, documentId, scale) =>
      Effect.sync(() => current?.service.scale(senderId, documentId, scale) ?? false),
  });
});

export const layer = Layer.effect(DesktopPanePictureRaster, make);
