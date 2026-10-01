import { SNIPPET_MARKERS, type SnippetSegment } from "@dsd/shared";

/**
 * Splits a `ts_headline` result on its marker characters into plain-text
 * segments, so the client highlights matches with its own elements and no
 * markup from the database ever reaches a page (NFR-7). Unbalanced markers
 * can't occur, because article text can't contain them; if one did, the
 * text would still come out whole, just not highlighted.
 */
export function snippetSegments(headline: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  const push = (text: string, highlighted: boolean) => {
    if (text !== "") segments.push({ text, highlighted });
  };
  for (const [index, part] of headline.split(SNIPPET_MARKERS.start).entries()) {
    if (index === 0) {
      push(part.replaceAll(SNIPPET_MARKERS.stop, ""), false);
      continue;
    }
    const stop = part.indexOf(SNIPPET_MARKERS.stop);
    if (stop === -1) {
      push(part, false);
      continue;
    }
    push(part.slice(0, stop), true);
    push(part.slice(stop + 1).replaceAll(SNIPPET_MARKERS.stop, ""), false);
  }
  return segments;
}
