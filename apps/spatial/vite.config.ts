import { defineConfig } from "vite-plus";

import webConfig from "../web/vite.config";

// Inherits the web app's toolchain (React Compiler, Tailwind, defines, dev
// proxy) so T3 components compile exactly as they do upstream.
export default defineConfig(async (env) => {
  const { test: _test, ...web } = await webConfig(env);
  return {
    ...web,
    publicDir: new URL("../web/public", import.meta.url).pathname,
    server: {
      ...web.server,
      port: Number(process.env.PORT ?? 5743),
    },
  };
});
