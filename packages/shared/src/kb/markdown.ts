import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/*
 * Knowledge-base markdown is written by staff and read by the public
 * (FR-15, FR-4), so it is treated as untrusted on both sides (NFR-7). The
 * API sanitises it when an article is saved, so whatever renders it later
 * (the help centre, an email, a prompt for the AI) starts from safe text;
 * the help centre also renders it without raw HTML and checks every URL
 * with `isSafeUrl` again.
 */

/** Snippet markers the search uses (U+E000, U+E001); they never appear in stored text. */
export const SNIPPET_MARKERS = { start: "\uE000", stop: "\uE001" } as const;

const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * Whether a link or image may point at `url`: http, https, mailto, or a
 * relative URL. Browsers ignore whitespace and control characters inside a
 * scheme (`java\tscript:`), so those are removed before the scheme is read.
 */
export function isSafeUrl(url: string): boolean {
  let compact = "";
  for (let index = 0; index < url.length; index += 1) {
    const code = url.charCodeAt(index);
    if (code > 0x20 && (code < 0x7f || code > 0x9f))
      compact += url.charAt(index);
  }
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact)?.[1];
  return scheme === undefined || SAFE_SCHEMES.has(scheme.toLowerCase());
}

interface Edit {
  start: number;
  end: number;
  replacement: string;
}

/** Where a node sits in the source, if the parser recorded it. */
function span(node: Nodes): { start: number; end: number } | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

/**
 * The edits for the outermost unsafe nodes. A node that is removed or
 * replaced isn't searched further: the next pass sees what replaced it.
 */
function unsafeNodes(node: Nodes, source: string, edits: Edit[]): void {
  const where = span(node);
  if (where !== undefined) {
    switch (node.type) {
      case "html":
        edits.push({ ...where, replacement: "" });
        return;
      case "image":
      case "definition":
        if (!isSafeUrl(node.url)) {
          edits.push({ ...where, replacement: "" });
          return;
        }
        break;
      case "link":
        if (!isSafeUrl(node.url)) {
          // Keep the link's text, drop the destination.
          const first = node.children[0];
          const last = node.children.at(-1);
          const from = first === undefined ? undefined : span(first)?.start;
          const to = last === undefined ? undefined : span(last)?.end;
          edits.push({
            ...where,
            replacement:
              from === undefined || to === undefined
                ? ""
                : source.slice(from, to),
          });
          return;
        }
        break;
      default:
        break;
    }
  }
  if ("children" in node) {
    for (const child of node.children) {
      unsafeNodes(child, source, edits);
    }
  }
}

/**
 * Parses markdown with GFM into a syntax tree. The sanitiser and the help
 * centre's renderer both use it, so they always agree on what a piece of
 * text is: the renderer can't see a link the sanitiser didn't.
 */
export function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

function sanitisePass(markdown: string): string {
  const tree = parseMarkdown(markdown);
  const edits: Edit[] = [];
  unsafeNodes(tree, markdown, edits);
  let result = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result =
      result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

/**
 * Removes raw HTML (inline and block, comments included), images and link
 * definitions with an unsafe URL, and the destination of an unsafe link,
 * keeping its text. Everything else stays byte for byte as the author
 * wrote it, because edits are made at the parser's source positions rather
 * than by re-printing the tree.
 *
 * A removal can expose something new (a link's text that holds HTML), so
 * passes repeat until one changes nothing. Every edit makes the text
 * strictly shorter, so that always happens.
 */
export function sanitizeMarkdown(markdown: string): string {
  let current = markdown
    .replaceAll(SNIPPET_MARKERS.start, "")
    .replaceAll(SNIPPET_MARKERS.stop, "");
  for (;;) {
    const next = sanitisePass(current);
    if (next === current) return current;
    current = next;
  }
}
