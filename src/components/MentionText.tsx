"use client";

/**
 * Render plain text with `@mention` tokens highlighted as chips. Used for chat message bodies
 * (plain strings) and as a lightweight highlight for comment text. PURELY presentational — it
 * does not resolve users or widen visibility; it just styles tokens that match the known handles.
 *
 * A token highlights only when it resolves to a real user handle (passed in `handles`), so a
 * literal "@noon" that matches nobody stays plain text — matching the server's resolution rule.
 */
import { Fragment } from "react";
import styles from "./MentionText.module.css";

const TOKEN = /(^|[^a-z0-9])@([a-z0-9._-]+)/gi;

export default function MentionText({
  text,
  handles,
}: {
  text: string;
  /** Lowercased set of resolvable handles (collapsed names + email local-parts). */
  handles: Set<string>;
}) {
  if (!text) return null;
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN)) {
    const full = m[0];
    const lead = m[1];
    const token = m[2];
    const start = m.index ?? 0;
    const at = start + lead.length;
    // text before the mention (including the lead char)
    if (at > last) out.push(<Fragment key={key++}>{text.slice(last, at)}</Fragment>);
    if (handles.has(token.toLowerCase())) {
      out.push(
        <span key={key++} className={styles.chip}>
          @{token}
        </span>,
      );
    } else {
      out.push(<Fragment key={key++}>{`@${token}`}</Fragment>);
    }
    last = start + full.length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return <>{out}</>;
}
