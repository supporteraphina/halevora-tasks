/**
 * Pure helpers for the keyboard-accessible "Move to…" path on board cards.
 *
 * Native HTML5 drag-and-drop has no keyboard equivalent, so a card also offers a menu that
 * moves it to the top or bottom of any board column. These helpers decide WHICH boards a card
 * can move to and translate a chosen slot into the `index` the server `moveCardAction` expects.
 * Framework-free so it unit-tests without a DOM.
 */

export interface BoardRef {
  id: string;
  name: string;
  /** Count of currently-visible cards in this column (used to compute a "bottom" index). */
  cardCount: number;
}

export type MovePosition = "top" | "bottom";

export interface MoveTarget {
  boardId: string;
  boardName: string;
  position: MovePosition;
  /** The `index` to pass to moveCardAction for this target. */
  index: number;
}

/**
 * Build the list of move targets for a card currently in `fromBoardId`. Every board gets a
 * "top" and a "bottom" target EXCEPT the card's own board, which only offers the opposite
 * end from where it sits would be ambiguous — so we offer both ends there too, letting a
 * keyboard user send a card to the very top or very bottom of its own column. The server
 * recomputes order from live neighbours, so the index is a best-effort slot, not a promise.
 */
export function moveTargets(
  boards: BoardRef[],
  fromBoardId: string,
  movingCardId: string,
): MoveTarget[] {
  const out: MoveTarget[] = [];
  for (const board of boards) {
    // When moving within the same column, the moved card is excluded from neighbour counting
    // server-side, so "bottom" is cardCount - 1 (one of the visible cards is the mover itself).
    const sameBoard = board.id === fromBoardId;
    const bottomIndex = sameBoard
      ? Math.max(0, board.cardCount - 1)
      : board.cardCount;
    out.push({
      boardId: board.id,
      boardName: board.name,
      position: "top",
      index: 0,
    });
    out.push({
      boardId: board.id,
      boardName: board.name,
      position: "bottom",
      index: bottomIndex,
    });
  }
  // movingCardId is accepted for symmetry with the UI and future per-card rules; not yet used
  // to filter, since a card may legitimately move to either end of any board (incl. its own).
  void movingCardId;
  return out;
}

/** Human label for a target, e.g. `Innovations — top`. */
export function moveTargetLabel(t: MoveTarget): string {
  return `${t.boardName} — ${t.position === "top" ? "top" : "bottom"}`;
}
