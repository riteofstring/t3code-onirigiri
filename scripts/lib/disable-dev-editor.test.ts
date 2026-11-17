// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - serves temporary files from a real Vite dev server and requests them over HTTP.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createServer } from "vite-plus";
import { expect, it } from "vite-plus/test";

import { disableDevEditor } from "./disable-dev-editor.ts";

it.each(["/", "/lab/", "/lab%20space/"])(
  "disables editor launching under %s and preserves development routes",
  async (base) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-dev-routes-"));
    try {
      await NodeFSP.writeFile(
        NodePath.join(root, "index.html"),
        '<!doctype html><script type="module" src="./fixture.ts"></script>',
      );
      await NodeFSP.writeFile(
        NodePath.join(root, "fixture.ts"),
        "export const value: number = 17;",
      );
      await NodeFSP.writeFile(
        NodePath.join(root, "__open-in-editorial.js"),
        'export const value = "ordinary module";',
      );
      const server = await createServer({
        configFile: false,
        root,
        base: base === "/lab/" ? "/lab" : base,
        plugins: [disableDevEditor()],
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true },
        server: { host: "127.0.0.1", port: 0, open: false, watch: null },
      });
      try {
        await server.listen();
        const address = server.httpServer?.address();
        if (!address || typeof address === "string") throw new Error("Missing HTTP listener");
        const origin = `http://127.0.0.1:${address.port}`;
        const headers = { connection: "close" };
        for (const path of [
          "/__open-in-editor",
          `${base}__open-in-editor`,
          `${base}__OPEN-IN-EDITOR`,
          `${base}__open-in-editor/`,
          `${base}__open-in-editor.json`,
          `${base}__open-in-editor?file=missing-fixture-file.ts`,
        ]) {
          const response = await fetch(`${origin}${path}`, { headers });
          expect(response.status, path).toBe(404);
          expect(await response.text(), path).toBe("");
        }
        const html = await fetch(`${origin}${base}index.html`, { headers });
        expect(html.status).toBe(200);
        expect(await html.text()).toContain(`${base}@vite/client`);
        const module = await fetch(`${origin}${base}fixture.ts`, { headers });
        expect(module.status).toBe(200);
        expect(await module.text()).toContain("export const value = 17");
        const ordinary = await fetch(`${origin}${base}__open-in-editorial.js`, { headers });
        expect(ordinary.status).toBe(200);
        expect(await ordinary.text()).toContain("ordinary module");
        const ping = await fetch(`${origin}${base}health`, {
          headers: { ...headers, accept: "text/x-vite-ping" },
        });
        expect(ping.status).toBe(204);
      } finally {
        await server.close();
      }
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  },
);
