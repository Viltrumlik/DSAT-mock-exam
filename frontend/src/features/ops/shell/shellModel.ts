import type { AttentionItem, AttentionSource } from "@/features/console/attention";

/**
 * The shell's numbers (lc-up structure canvas, 22 Nov 2026): counts sit only on verdicts — Today's "Needs you"
 * (from the bell's own sources, no request of its own) and Finance's debtors.
 */

/** The items that are there to act on (a source still loading or failed has none — the bell says so). */
export function attentionItems(sources: readonly AttentionSource[]): AttentionItem[] {
  return sources.flatMap((s) => (s.status === "done" && s.item ? [s.item] : []));
}
