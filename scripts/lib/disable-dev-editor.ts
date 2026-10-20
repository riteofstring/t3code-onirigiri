import type { Connect, Plugin } from "vite-plus";

export function disableDevEditor(): Plugin {
  return {
    name: "t3code:disable-dev-editor",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      const deny: Connect.SimpleHandleFunction = (_request, response) => {
        response.statusCode = 404;
        response.end();
      };
      server.middlewares.use("/__open-in-editor", deny);
      if (server.config.base !== "/") {
        server.middlewares.use(`${server.config.base}__open-in-editor`, deny);
      }
    },
  };
}
