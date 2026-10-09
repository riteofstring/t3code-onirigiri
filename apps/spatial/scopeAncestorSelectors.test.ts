import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { build, createServer } from "vite";
import { describe, expect, it } from "vite-plus/test";

import { rewriteAncestorIsSelectors, scopeAncestorSelectors } from "./scopeAncestorSelectors";

describe("rewriteAncestorIsSelectors", () => {
  it.each([
    [
      ".group-focus-visible\\:opacity-100:is(:where(.group):focus-visible *){opacity:1}",
      ":where(.group):focus-visible .group-focus-visible\\:opacity-100{opacity:1}",
    ],
    [
      ".a:is(:where(.group\\/title):focus-visible *),.b:is(:where(.group\\/close):focus-visible *){opacity:1}",
      ":where(.group\\/title):focus-visible .a,:where(.group\\/close):focus-visible .b{opacity:1}",
    ],
    [
      "@media (hover:hover){.a:is(:where(.group):focus-visible *)::before{opacity:1}}",
      "@media (hover:hover){:where(.group):focus-visible .a::before{opacity:1}}",
    ],
    [
      '.a:is(:where(.group[data-note="a),b"]):focus-visible *){opacity:1}',
      ':where(.group[data-note="a),b"]):focus-visible .a{opacity:1}',
    ],
    [".a:is(.peer:focus-visible ~ *){opacity:1}", ".peer:focus-visible ~ .a{opacity:1}"],
    [
      ".a\\:b:is(:where(.g\\/x):has(button:hover) *){c:d}",
      ":where(.g\\/x):has(button:hover) .a\\:b{c:d}",
    ],
    [
      ".c:is(:where(.g\\/x):has([data-y]) *)::before{c:d}",
      ":where(.g\\/x):has([data-y]) .c::before{c:d}",
    ],
    [':is(.h:has([data-a="b"]) *):is(input){c:d}', '.h:has([data-a="b"]) :is(input){c:d}'],
    [
      ':is(.k:has(+ [data-s="t"]) > *)[data-s="i"]{c:d}',
      '.k:has(+ [data-s="t"]) > [data-s="i"]{c:d}',
    ],
    [":is(.a:has(.b) *){c:d}", ".a:has(.b) *{c:d}"],
    [":is(.a:has(.b) *)::before{c:d}", ".a:has(.b) *::before{c:d}"],
    ["@media (x){.a:is(:where(.g):has(b) *){c:d}}", "@media (x){:where(.g):has(b) .a{c:d}}"],
    [".z,.a:is(:where(.g):has(b) *){c:d}", ".z,:where(.g):has(b) .a{c:d}"],
  ])("moves the ancestor out of :is() in %s", (input, output) => {
    expect(rewriteAncestorIsSelectors(input)).toBe(output);
  });

  it.each([
    [".p .q:is(:where(.g):not(:has(> [d])) *){c:d}"],
    [".p > .x:is(.a:has(.b) *){c:d}"],
    [".n:not(:is(.g:has(a) *)){c:d}"],
    [".l:is(.g:has(a) *, .h *){c:d}"],
    [".m:is(.g *){c:d}"],
    [".p > .x:is(:where(.group):focus-visible *){opacity:1}"],
    [".n:not(:is(:where(.group):focus-visible *)){opacity:1}"],
    [".l:is(:where(.group):focus-visible *, .h *){opacity:1}"],
    [".a:is(:where(.group):focus-visible \\*){opacity:1}"],
    ['.p > .a[data-note="a)"]:is(:where(.group):focus-visible *){opacity:1}'],
    [".\\32 xl\\:a:is(:where(.group):focus-visible *){opacity:1}"],
  ])("leaves %s unchanged", (input) => {
    expect(rewriteAncestorIsSelectors(input)).toBe(input);
  });
});

it("scopes served and built CSS without rewriting nested rules or declaration values", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "spatial-selector-css-"));
  const css = `
@layer utilities {
  .subject:is(:where(.group):focus-visible *) { opacity: 1 }
  .label::after { content: ".keep:is(.a:has(.b) *)" }
  .outer {
    @media (min-width: 1px) {
      .nested:is(:where(.group):focus-visible *) { opacity: 0.5 }
    }
  }
}`;
  try {
    await NodeFSP.writeFile(
      NodePath.join(root, "index.html"),
      '<link rel="stylesheet" href="/style.css">',
    );
    await NodeFSP.writeFile(NodePath.join(root, "style.css"), css);
    const server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [scopeAncestorSelectors()],
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      const served = await server.transformRequest("/style.css?direct");
      expect(served?.code).toContain(":where(.group):focus-visible .subject");
      expect(served?.code).toContain(".nested:is(:where(.group):focus-visible *)");
      expect(served?.code).toContain('content: ".keep:is(.a:has(.b) *)"');
    } finally {
      await server.close();
    }
    let builtCss = "";
    await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [
        scopeAncestorSelectors(),
        {
          name: "read-built-css",
          generateBundle(_options, bundle) {
            for (const asset of Object.values(bundle)) {
              if (asset.type === "asset" && asset.fileName.endsWith(".css")) {
                builtCss += String(asset.source);
              }
            }
          },
        },
      ],
      build: { write: false, cssMinify: false },
    });
    expect(builtCss).toContain(":where(.group):focus-visible .subject");
    expect(builtCss).toContain(".keep:is(.a:has(.b) *)");
    expect(builtCss).toContain(".nested:is(:where(.group):focus-visible *)");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
