import type { Root } from "mdast";
import type { Parser as UnifiedParser, Plugin } from "unified";

type Parser = UnifiedParser<Root>;

const MAX_DOCUMENTS = 400;
const MAX_SOURCE_CHARACTERS = 1_000_000;

/** Reuse parsed syntax trees for completed documents. Remounting a conversation
 * renders the same messages again, and micromark tokenization dominates that cost.
 * Create one plugin per remark plugin list: earlier plugins configure the parser,
 * so a tree is only valid for the list it was parsed with. Streaming text changes
 * on every token and belongs to the incremental parser instead.
 */
export function createMarkdownParseCachePlugin(): Plugin<[], Root> {
  const documents = new Map<string, Root>();
  let sourceCharacters = 0;

  const remember = (source: string, root: Root) => {
    documents.set(source, structuredClone(root));
    sourceCharacters += source.length;
    for (const [oldest] of documents) {
      if (documents.size <= MAX_DOCUMENTS && sourceCharacters <= MAX_SOURCE_CHARACTERS) break;
      documents.delete(oldest);
      sourceCharacters -= oldest.length;
    }
  };

  return function () {
    const original = this.parser;
    if (!original) return;
    const parse = (source: string, file: Parameters<Parser>[1]) => original(source, file) as Root;
    // ReactMarkdown creates a processor per render and parses the document first.
    // Later parses on that processor are synthetic transform input, not the document.
    let documentParsed = false;
    this.parser = (source, file) => {
      if (documentParsed) return parse(source, file);
      documentParsed = true;
      const cached = documents.get(source);
      if (cached) {
        documents.delete(source);
        documents.set(source, cached);
        // Remark transforms mutate their input; each render receives its own copy.
        return structuredClone(cached);
      }
      const root = parse(source, file);
      if (source.length <= MAX_SOURCE_CHARACTERS) remember(source, root);
      return root;
    };
  };
}
