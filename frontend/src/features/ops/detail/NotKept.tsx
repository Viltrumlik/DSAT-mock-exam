"use client";

import { Icon } from "@/components/ui/Icon";

/**
 * A tab lc-up has whose record this system does not keep yet (lc-up structure, 22 Nov 2026): one honest line,
 * never sample rows. `what` names the record: "Discounts are not kept in this system yet."
 */
export function NotKept({ children }: { children: string }) {
  return (
    <p data-testid="not-kept" className="flex items-center gap-2.5 rounded-ms-ctl border border-dashed border-ms-border-strong px-4 py-3.5 text-[14px] text-ms-fg-2">
      <Icon name="info" size="sm" className="text-ms-fg-3" />
      {children}
    </p>
  );
}
