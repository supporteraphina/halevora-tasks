import styles from "./panel.module.css";

/**
 * Instant placeholder for the task detail panel. Shown by the route `loading.tsx` the moment
 * a card is clicked, while the real detail renders on the server (~150ms). It mirrors the
 * panel shell — backdrop + drawer + a title/status/field skeleton — so opening a task feels
 * immediate instead of hanging on a blank click. Static; no interactivity.
 */
export default function TaskPanelSkeleton() {
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Loading task"
      aria-busy="true"
    >
      <div className={`${styles.backdrop} hv-scrim`} aria-hidden="true" />
      <aside className={`${styles.panel} hv-drawer`}>
        <header className={styles.panelHeader}>
          <span
            className={styles.sectionLoading}
            style={{ minHeight: "0.9rem", width: "7rem", borderRadius: "var(--radius-sm)" }}
          />
        </header>
        <div className={styles.scroll}>
          <span
            className={styles.sectionLoading}
            style={{ minHeight: "1.9rem", width: "65%", borderRadius: "var(--radius-sm)" }}
          />
          <span
            className={styles.sectionLoading}
            style={{ minHeight: "1.6rem", width: "6.5rem", borderRadius: "var(--radius-sm)" }}
          />
          <div className={styles.sectionLoading} style={{ minHeight: "13rem" }} />
          <div className={styles.sectionLoading} style={{ minHeight: "7rem" }} />
          <div className={styles.sectionLoading} style={{ minHeight: "10rem" }} />
        </div>
      </aside>
    </div>
  );
}
