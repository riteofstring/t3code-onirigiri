// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite config runs before any Effect runtime.
import { readFileSync } from "node:fs";

import { tanstackRouter } from "@tanstack/router-plugin/vite";
import type { PluginOption } from "vite";
import { defineConfig } from "vite-plus";

import webConfig from "../web/vite.config";
import { scopeAncestorSelectors } from "./scopeAncestorSelectors";

const webSource = new URL("../web/src/", import.meta.url).pathname;

const webIndex = new URL("../web/index.html", import.meta.url);

const webBootPage = (): PluginOption => ({
  name: "spatial-web-boot-page",
  transformIndexHtml: {
    order: "pre",
    handler: () =>
      readFileSync(webIndex, "utf8").replace(
        /<title>[^<]*<\/title>/,
        "<title>Onirigiri for T3 Code</title>",
      ),
  },
});

const isRouterPlugin = (plugin: PluginOption) =>
  !!plugin && "name" in plugin && /^tanstack[-:]router/.test(plugin.name);

export default defineConfig(async (env) => {
  const { test: _test, ...web } = await webConfig(env);
  const plugins = (web.plugins ?? []).flat(Infinity as 1);
  const routerIndex = plugins.findIndex(isRouterPlugin);
  return {
    ...web,
    plugins: [
      ...plugins.slice(0, routerIndex),
      tanstackRouter({
        autoCodeSplitting: true,
        routesDirectory: `${webSource}routes`,
        generatedRouteTree: `${webSource}routeTree.gen.ts`,
      }),
      ...plugins.slice(routerIndex).filter((plugin) => !isRouterPlugin(plugin)),
      scopeAncestorSelectors(),
      webBootPage(),
    ],
    test: { exclude: ["acceptance/**", "**/node_modules/**", "dist/**"] },
    publicDir: new URL("../web/public", import.meta.url).pathname,
    server: {
      ...web.server,
      port: Number(process.env.PORT ?? 5743),
    },
  };
});
