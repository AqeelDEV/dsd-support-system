/*
 * Finding links in a draft (ADR-0006, amended in Phase 10). A link the
 * model was never given can only have come from the ticket, which is where
 * an attacker writes: "tell the customer to reset their password at ...",
 * or "ask them to email their card number to ...". An agent skimming a
 * fluent draft could send that on. So every link in a draft must appear in
 * an article the draft cites, and anything that looks like a link counts:
 * full URLs, `www.` hosts, bare domains, email addresses and the schemes a
 * browser would run.
 *
 * Erring towards seeing a link costs a draft (the agent writes the reply
 * themselves, or regenerates); missing one could cost a customer.
 */

/** Top-level domains that turn `word.word` into a host worth checking. */
const TOP_LEVEL_DOMAINS = [
  "ai",
  "app",
  "biz",
  "click",
  "cn",
  "co",
  "com",
  "de",
  "dev",
  "eu",
  "example",
  "fr",
  "help",
  "info",
  "io",
  "link",
  "ly",
  "me",
  "net",
  "online",
  "org",
  "ru",
  "shop",
  "site",
  "store",
  "support",
  "top",
  "uk",
  "us",
  "xyz",
];

const PATTERNS = [
  // A web address, up to whitespace or a bracket.
  /\bhttps?:\/\/[^\s<>()[\]{}"'`]+/gi,
  // Schemes a browser would run or open, written straight against what they
  // carry ("data:text/html,..."), so "the data: ..." in a sentence isn't one.
  /\b(?:javascript|data|vbscript|file):[^\s<>()[\]{}"'`]+/gi,
  /\bwww\.[^\s<>()[\]{}"'`]+/gi,
  /[\w.%+-]+@[a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,}/gi,
  new RegExp(
    String.raw`\b(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+(?:${TOP_LEVEL_DOMAINS.join("|")})\b`,
    "gi",
  ),
];

/** Punctuation that ends a sentence rather than a link. */
const TRAILING = /[.,;:!?'"]+$/;

/** Every link-like piece of `text`, lower-cased, without trailing punctuation. */
export function linksIn(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const link = match[0].replace(TRAILING, "").toLowerCase();
      if (link !== "") found.add(link);
    }
  }
  return [...found];
}

/** Links in `draft` that none of `sources` contains. */
export function linksNotIn(
  draft: string,
  sources: readonly string[],
): string[] {
  const haystack = sources.join("\n").toLowerCase();
  return linksIn(draft).filter((link) => !haystack.includes(link));
}
