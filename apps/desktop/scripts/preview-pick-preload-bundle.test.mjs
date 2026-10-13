import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeVM from "node:vm";
import { build } from "vite-plus/pack";
import { assert, it } from "vite-plus/test";

import desktopConfig from "../vite.config.ts";

it("loads the emitted guest keyboard bridge with only Electron available", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-preview-preload-"));
  try {
    const config = desktopConfig.pack.find((candidate) =>
      candidate.entry.includes("src/preview-pick-preload.ts"),
    );
    assert.ok(config);
    await build({
      ...config,
      config: false,
      cwd: NodeURL.fileURLToPath(new URL("../", import.meta.url)),
      outDir: directory,
      logLevel: "silent",
    });
    const source = await NodeFSP.readFile(
      NodePath.join(directory, "preview-pick-preload.cjs"),
      "utf8",
    );
    const ipcListeners = new Map();
    const keyListeners = [];
    const sent = [];
    const required = [];
    class Window {
      requestAnimationFrame() {
        return 0;
      }
      cancelAnimationFrame() {}
      addEventListener(type, listener) {
        if (type === "keydown") keyListeners.push(listener);
      }
    }
    NodeVM.runInNewContext(
      source,
      {
        require: (specifier) => {
          required.push(specifier);
          assert.equal(specifier, "electron");
          return {
            ipcRenderer: {
              on: (channel, listener) => ipcListeners.set(channel, listener),
              send: () => {},
              sendToHost: (...args) => sent.push(args),
            },
          };
        },
        Window,
        window: new Window(),
        document: { hasFocus: () => true },
        HTMLElement: class {
          closest() {
            return null;
          }
        },
      },
      { timeout: 1_000 },
    );
    assert.deepEqual(required, ["electron"]);
    const configure = ipcListeners.get("preview:host-shortcuts");
    assert.equal(typeof configure, "function");
    const shortcut = {
      key: "ArrowRight",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    };
    let prevented = 0;
    const event = {
      ...shortcut,
      code: "ArrowRight",
      keyCode: 39,
      repeat: false,
      isComposing: false,
      isTrusted: true,
      defaultPrevented: false,
      composedPath: () => [],
      getModifierState: () => false,
      preventDefault: () => prevented++,
      stopImmediatePropagation: () => {},
    };
    for (const listener of keyListeners) listener(event);
    assert.equal(sent.length, 0);
    assert.equal(prevented, 0);
    configure({}, [shortcut]);
    for (const listener of keyListeners) listener(event);
    assert.equal(prevented, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], "preview:host-key");
    assert.equal(sent[0][1].key, "ArrowRight");
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
