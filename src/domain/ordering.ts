/**
 * Fractional ordering for drag-reorder. Pure, framework-free domain logic.
 *
 * Each card carries a Float `order` within its (board) column. Reordering writes a single
 * row: the moved card gets a value strictly between its new neighbors (a midpoint), so a
 * reorder is O(1) regardless of column size. Over many reorders the floats can crowd
 * together; `needsRenormalize` detects that and `renormalize` hands back a fresh,
 * evenly-spaced sequence the caller persists in one pass.
 */

/** Default spacing between freshly-normalized orders. Large enough for many midpoints. */
export const ORDER_STEP = 1000;

/** Smallest gap we tolerate between two neighbors before forcing a renormalize. */
const EPSILON = 1e-4;

/** Order for a brand-new card appended to the end of a column. */
export function appendOrder(maxOrder: number | null | undefined): number {
  if (maxOrder == null) return ORDER_STEP;
  return maxOrder + ORDER_STEP;
}

/** The value strictly between two orders. */
export function midpoint(a: number, b: number): number {
  return (a + b) / 2;
}

/**
 * Target order for a card dropped at `index` within a column, given the column's current
 * orders (sorted ascending, EXCLUDING the moved card). `index` is the desired final slot:
 * 0 = before the first neighbor, `neighbors.length` = after the last.
 */
export function orderForMove(neighbors: number[], index: number): number {
  if (neighbors.length === 0) return ORDER_STEP;

  const i = Math.max(0, Math.min(index, neighbors.length));

  if (i === 0) {
    // Before the first card: halve the smallest order (keeps it positive).
    return neighbors[0] / 2;
  }
  if (i >= neighbors.length) {
    // After the last card: step beyond the largest order.
    return neighbors[neighbors.length - 1] + ORDER_STEP;
  }
  // Between two cards.
  return midpoint(neighbors[i - 1], neighbors[i]);
}

/**
 * True when a column's ascending orders have collided or crowded close enough that the
 * next midpoint would be unsafe — the signal to renormalize.
 */
export function needsRenormalize(orders: number[]): boolean {
  for (let i = 1; i < orders.length; i++) {
    if (orders[i] - orders[i - 1] < EPSILON) return true;
  }
  return false;
}

/** A fresh, evenly-spaced ascending order sequence for a column of `count` cards. */
export function renormalize(count: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= count; i++) out.push(ORDER_STEP * i);
  return out;
}
