import type { Plugin } from "vite";

/**
 * Tailwind writes ancestor variants such as `group-has-*`,
 * `group-focus-visible:*` and `has-*:**` as
 * `X:is(A *)`: the element matches X and has an ancestor matching A. When A
 * contains `:has()` or `:focus-visible`, Chromium cannot scope the invalidation
 * of that nested selector, so DOM changes or workspace focus can restyle
 * unrelated panes. The equivalent `A X` has the same matches and specificity,
 * and Chromium scopes it to the subtrees of elements matching A. Only `:is()`
 * holding one complex selector ending in a universal selector after a
 * combinator, in the first compound of a flat selector, is rewritten.
 */
export function rewriteAncestorIsSelectors(css: string): string {
  let out = "";
  let index = 0;
  while (index < css.length) {
    const start = css.indexOf(":is(", index);
    if (start < 0) break;
    const end = matchingParen(css, start + 3);
    if (end < 0) break;
    const argument = css.slice(start + 4, end);
    const ancestor = ancestorOf(argument);
    const compoundStart = compoundStartBefore(css, start);
    if (
      ancestor === null ||
      compoundStart < index ||
      !opensSelector(css, compoundStart) ||
      (!argument.includes(":has(") && !argument.includes(":focus-visible"))
    ) {
      out += css.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    const rest = css.slice(compoundStart, start);
    // A compound left with nothing but pseudo-elements, or nothing, keeps `*`.
    const subject =
      rest === "" && !/^[.#[\w-]|^:(?!:)/.test(css.slice(end + 1, end + 3)) ? "*" : "";
    out += css.slice(index, compoundStart) + ancestor + rest + subject;
    index = end + 1;
  }
  return out + css.slice(index);
}

function matchingParen(text: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") {
      i++;
    } else if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")" && --depth === 0) {
      return i;
    }
  }
  return -1;
}

// Remove only the final universal selector, preserving its combinator.
function ancestorOf(argument: string): string | null {
  let depth = 0;
  let quote = "";
  for (let i = 0; i < argument.length; i++) {
    const char = argument[i];
    if (char === "\\") i++;
    else if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) return null;
  }
  return /^(.*(?:\s|[>+~]))\*$/s.exec(argument)?.[1] ?? null;
}

// Whether the compound at `start` is the first of its complex selector: only
// then does `X:is(A *)` equal `A X`. After a combinator, as in `.p > X`, A would
// land between the combinator and X and change the matches.
function opensSelector(css: string, start: number): boolean {
  let i = start - 1;
  while (i >= 0 && /\s/.test(css[i]!)) i--;
  return i < 0 || css[i] === "," || css[i] === "{" || css[i] === "}";
}

// Start of the top-level compound selector that contains position `at`, or
// -1 when `at` sits inside another function such as `:not()`.
function compoundStartBefore(css: string, at: number): number {
  let depth = 0;
  let quote = "";
  for (let i = at - 1; i >= 0; i--) {
    const char = css[i]!;
    if (css[i - 1] === "\\") continue;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ")" || char === "]") depth++;
    else if (char === "(" || char === "[") {
      if (depth === 0) return -1;
      depth--;
    } else if (depth === 0 && /[\s>+~,{}]/.test(char)) {
      return i + 1;
    }
  }
  return 0;
}

export function scopeAncestorSelectors(): Plugin {
  return {
    name: "spatial:scope-ancestor-selectors",
    config() {
      return {
        css: {
          postcss: {
            plugins: [
              {
                postcssPlugin: "spatial:scope-ancestor-selectors",
                Rule(rule) {
                  let parent = rule.parent;
                  while (parent?.type === "atrule") parent = parent.parent;
                  if (parent?.type !== "root") return;
                  const selector = rewriteAncestorIsSelectors(rule.selector);
                  if (selector !== rule.selector) rule.selector = selector;
                },
              },
            ],
          },
        },
      };
    },
  };
}
