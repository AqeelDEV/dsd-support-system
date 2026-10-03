/*
 * Reciprocal Rank Fusion (ADR-0006, section 4): each item scores the sum
 * of 1 / (k + rank) over the ranked lists it appears in. It uses ranks
 * only, so cosine similarity and ts_rank_cd, which live on different
 * scales, never have to be calibrated against each other. k = 60 is the
 * value from the original paper and damps the gap between the top ranks.
 */

export const RRF_K = 60;

export interface Fused {
  id: string;
  score: number;
  /** The item's 1-based rank in each input list, or null where it is absent. */
  ranks: (number | null)[];
}

/**
 * The top `limit` items of `lists` (each a list of IDs, best first), by
 * fused score. Ties go to the item with the better single rank, then to
 * the smaller ID, so the order is always the same.
 */
export function fuse(
  lists: readonly (readonly string[])[],
  limit: number,
): Fused[] {
  const items = new Map<string, Fused>();
  lists.forEach((list, listIndex) => {
    list.forEach((id, position) => {
      const item = items.get(id) ?? {
        id,
        score: 0,
        ranks: lists.map(() => null),
      };
      if (item.ranks[listIndex] !== null) return;
      item.ranks[listIndex] = position + 1;
      item.score += 1 / (RRF_K + position + 1);
      items.set(id, item);
    });
  });
  const best = (item: Fused) =>
    Math.min(...item.ranks.map((rank) => rank ?? Number.POSITIVE_INFINITY));
  return [...items.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        best(a) - best(b) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, limit);
}
