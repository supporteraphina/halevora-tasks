import styles from "./board.module.css";

/**
 * Instant board skeleton, shown the moment you navigate to /board while the real board
 * (columns + cards) loads on the server (~150ms). Removes the blank wait before the board
 * appears — the shell (breadcrumb + projects rail + column/card placeholders) renders
 * immediately and is replaced by real data when the query lands. Static; no interactivity.
 */
export default function BoardLoading() {
  const columns = [0, 1, 2, 3];
  const cards = [0, 1, 2];
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading board">
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <span className={styles.crumb}>Team Space</span>
        <span className={styles.crumbSep} aria-hidden="true">
          /
        </span>
        <span className={styles.crumbCurrent}>Halevora</span>
      </nav>

      <div className={styles.body}>
        <aside className={styles.rail} aria-label="Projects">
          <p className={styles.railHeading}>Projects</p>
        </aside>

        <div className={styles.boardScroll}>
          <div className={styles.columns}>
            {columns.map((c) => (
              <div key={c} className={styles.column}>
                <div className={styles.colHeader}>
                  <span className={styles.skelDot} />
                  <span className={styles.skelLine} style={{ width: "7rem" }} />
                </div>
                <div className={styles.cardList}>
                  {cards.map((k) => (
                    <span key={k} className={styles.skelCard} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
