import { MessageChannelMain, session } from "electron";
import type { BrowserWindow, BrowserWindowConstructorOptions, MessagePortMain } from "electron";

import * as Protocol from "./PanePictureProtocol.ts";

const helperDocument =
  "data:text/html;base64," +
  Buffer.from(
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" ' +
      "content=\"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; " +
      "script-src 'none'; connect-src 'none'; font-src 'none'; child-src 'none'; " +
      "object-src 'none'; base-uri 'none'; form-action 'none'\">",
  ).toString("base64");

export function createPanePictureRaster(
  ownerWindow: BrowserWindow,
  createWindow: (options: BrowserWindowConstructorOptions) => Promise<BrowserWindow>,
  preloadPath: string,
) {
  const owner = ownerWindow.webContents;
  type Connection = {
    documentId: string;
    created: Promise<BrowserWindow>;
    window: BrowserWindow | null;
    ports: MessagePortMain[];
    closing: Promise<void> | null;
  };
  let current: Connection | null = null;
  let disabled = false;
  let disposed = false;

  const close = (connection: Connection): Promise<void> => {
    if (connection.closing) return connection.closing;
    const closed = Promise.withResolvers<void>();
    connection.closing = closed.promise;
    if (current === connection) disabled = true;
    for (const port of connection.ports) port.close();
    connection.ports = [];
    if (connection.window && !connection.window.isDestroyed()) connection.window.destroy();
    void connection.created
      .then(
        (window) => {
          if (!window.isDestroyed()) window.destroy();
        },
        () => {},
      )
      .then(() => {
        if (!owner.isDestroyed()) owner.send(Protocol.UNAVAILABLE, connection.documentId);
      })
      .then(closed.resolve, closed.reject);
    return connection.closing;
  };
  const navigation = () => {
    const previous = current;
    current = null;
    disabled = false;
    if (previous) void close(previous);
  };
  const lost = () => {
    disabled = true;
    if (current) void close(current);
  };
  const dispose = async () => {
    disposed = true;
    owner.removeListener("did-navigate", navigation);
    owner.removeListener("render-process-gone", lost);
    owner.removeListener("destroyed", destroyed);
    if (current) await close(current);
  };
  const destroyed = () => {
    void dispose();
  };
  owner.on("did-navigate", navigation);
  owner.on("render-process-gone", lost);
  owner.on("destroyed", destroyed);

  return {
    dispose,
    async connect(documentId: string, isCurrentDocument?: () => boolean): Promise<boolean> {
      if (disposed || disabled || current || owner.isDestroyed()) return false;
      const frame = owner.mainFrame;
      const isCurrent = isCurrentDocument ?? (() => !frame.detached && frame === owner.mainFrame);
      if (!isCurrent()) return false;
      const isolated = session.fromPartition(`t3code-pane-picture-${owner.id}`);
      isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      isolated.setPermissionCheckHandler(() => false);
      isolated.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !/^(?:data:|blob:)/.test(details.url) });
      });
      const created = createWindow({
        width: 1200,
        height: 900,
        show: false,
        focusable: false,
        parent: ownerWindow,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          backgroundThrottling: false,
          offscreen: true,
          session: isolated,
          webSecurity: true,
          allowRunningInsecureContent: false,
          preload: preloadPath,
        },
      });
      const connection: Connection = {
        documentId,
        created,
        window: null,
        ports: [],
        closing: null,
      };
      current = connection;
      try {
        const window = await created;
        connection.window = window;
        if (connection.closing || disposed || current !== connection || !isCurrent()) {
          await close(connection);
          return false;
        }
        window.on("closed", () => {
          void close(connection);
        });
        window.webContents.on("render-process-gone", () => {
          void close(connection);
        });
        window.webContents.on("preload-error", () => {
          void close(connection);
        });
        window.webContents.on("will-navigate", (event) => event.preventDefault());
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        await window.loadURL(helperDocument);
        if (
          connection.closing ||
          disposed ||
          current !== connection ||
          owner.isDestroyed() ||
          !isCurrent()
        ) {
          await close(connection);
          return false;
        }
        const processId = window.webContents.getOSProcessId();
        if (processId === 0 || processId === owner.getOSProcessId()) {
          await close(connection);
          return false;
        }
        const { port1, port2 } = new MessageChannelMain();
        connection.ports = [port1, port2];
        owner.postMessage(Protocol.PORT, documentId, [port1]);
        window.webContents.postMessage(Protocol.PORT, documentId, [port2]);
        return true;
      } catch {
        await close(connection);
        return false;
      }
    },
    async stop(documentId: string): Promise<void> {
      if (current?.documentId === documentId) await close(current);
    },
    scale(senderId: number, documentId: string, scale: number): boolean {
      const window = current?.window;
      if (
        !current ||
        current.documentId !== documentId ||
        current.closing ||
        !window ||
        window.isDestroyed() ||
        window.webContents.id !== senderId ||
        !Number.isFinite(scale) ||
        scale < 0.5 ||
        scale > 4
      )
        return false;
      window.webContents.setZoomFactor(1);
      window.webContents.enableDeviceEmulation({
        screenPosition: "desktop",
        screenSize: { width: 1200, height: 900 },
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: scale,
        viewSize: { width: 1200, height: 900 },
        scale: 1,
      });
      return true;
    },
  };
}
