import type { Plugin } from "vite";

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

function opensSelector(css: string, start: number): boolean {
  let i = start - 1;
  while (i >= 0 && /\s/.test(css[i]!)) i--;
  return i < 0 || css[i] === "," || css[i] === "{" || css[i] === "}";
}

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
