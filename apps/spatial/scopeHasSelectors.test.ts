import { describe, expect, it } from "vite-plus/test";

import { rewriteAncestorIsSelectors } from "./scopeHasSelectors";

describe("rewriteAncestorIsSelectors", () => {
  it.each([
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
  ])("leaves %s unchanged", (input) => {
    expect(rewriteAncestorIsSelectors(input)).toBe(input);
  });
});
