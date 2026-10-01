/**
 * A URL slug from a title or name: accents dropped, lowercase words joined
 * by hyphens, at most 100 characters. `fallback` covers a title made only
 * of symbols.
 */
export function slugify(text: string, fallback: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 100)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? fallback : slug;
}
