import { defineConfig } from "astro/config";
import { disableDevEditor } from "../../scripts/lib/disable-dev-editor.ts";

export default defineConfig({
  vite: { plugins: [disableDevEditor()] },
  site: "https://t3.codes",
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
});
