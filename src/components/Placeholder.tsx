import styles from "./page.module.css";

export default function Placeholder({
  title,
  note,
}: {
  title: string;
  note: string;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
      </header>
      <section className={styles.empty}>
        <p className={styles.emptyText}>{note}</p>
      </section>
    </div>
  );
}
