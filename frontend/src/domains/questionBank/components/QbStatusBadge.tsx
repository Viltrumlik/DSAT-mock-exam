import { Badge, type BadgeTone } from "@/features/console/ui";
import type { QbStatus } from "../types";
import { STATUS_LABELS } from "../utils";

/**
 * A bank question's status on the console's badge (PR 16a), in its verdict's tone: waiting for a reviewer is
 * amber, approved green, rejected red; imported is neutral and archived only outlined. The words are the bank's.
 */
const STATUS_TONE: Record<QbStatus, BadgeTone> = {
  IMPORTED: "neutral",
  TRIAGE: "attention",
  APPROVED: "positive",
  REJECTED: "critical",
  ARCHIVED: "line",
};

export function QbStatusBadge({ status, className }: { status: QbStatus; className?: string }) {
  const tone = STATUS_TONE[status];
  return (
    <Badge tone={tone} dot={tone === "positive" || tone === "attention" || tone === "critical"} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
