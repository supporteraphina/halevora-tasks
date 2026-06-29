import styles from "@/components/page.module.css";

export default function BoardPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Board</h1>
        <p className={styles.subtitle}>Your columns of work.</p>
      </header>
      <section className={styles.empty} aria-label="Empty board">
        <span className={styles.emptyIcon} aria-hidden="true">
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="4" y="6" width="9" height="28" rx="2" />
            <rect x="15.5" y="6" width="9" height="20" rx="2" />
            <rect x="27" y="6" width="9" height="24" rx="2" />
          </svg>
        </span>
        <h2 className={styles.emptyTitle}>No boards yet</h2>
        <p className={styles.emptyText}>
          Boards are your columns of work, like Innovations or Client success.
          Create one to start adding tasks.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn}>
            New board
          </button>
        </div>
      </section>
    </div>
  );
}
