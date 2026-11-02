"use client";

import { formatUzs } from "./financeApi";
import styles from "./DebtTicker.module.css";

/** One half of the track has to be wider than the widest screen, or the loop shows a hole. */
const COPIES_PER_HALF = 12;

/**
 * The red band under the header (owner, 2026-11-02: "headerning tagida lenta bo'lishi kerak ...
 * aylanib turishi kerak o'ngdan chapga"). A screen reader hears the sentence once, and so does
 * everyone when motion is reduced (the stylesheet hides the other copies).
 */
export function DebtTicker({ debt }: { debt: number }) {
  const text = `You owe ${formatUzs(debt)}. Please visit the administration.`;
  return (
    <div role="status" className={styles.bar}>
      <div className={styles.track}>
        {Array.from({ length: COPIES_PER_HALF * 2 }, (_, i) => (
          <span key={i} className={styles.copy} aria-hidden={i > 0 ? true : undefined}>
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
