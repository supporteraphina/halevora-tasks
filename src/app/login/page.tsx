import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "Sign in — Halevora Tasks",
};

export default function LoginPage() {
  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="3" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="8" y="3" width="4" height="9" rx="1" fill="currentColor" opacity="0.7" />
              <rect x="14" y="3" width="4" height="11" rx="1" fill="currentColor" opacity="0.45" />
            </svg>
          </span>
          <span className={styles.wordmark}>Halevora Tasks</span>
        </div>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>Sign in with your Halevora account.</p>
        <LoginForm />
      </div>
    </main>
  );
}
