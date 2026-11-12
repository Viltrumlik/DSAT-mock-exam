"use client";

import { useState, type ReactNode } from "react";

import {
  Badge,
  BulkBar,
  Button,
  Checkbox,
  ChipCount,
  EmptyState,
  ErrorState,
  FilterChip,
  Pagination,
  SearchField,
  bulkButtonClass,
  chipClass,
} from "@/features/console/ui";
import { Icon } from "@/components/ui/Icon";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-ms-over text-ms-fg-3">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/**
 * The console's controls in their states (design handoff v0.3, Controls and DataDisplay boards):
 * what `features/console/ui` exports, as the list pages use it. Samples only; nothing here acts.
 */
export function ControlsSection() {
  const [ticks, setTicks] = useState({ a: true, b: false });
  return (
    <div className="flex flex-col gap-7 rounded-ms-card bg-ms-card p-6 shadow-ms-1">
      <Row label="Buttons · 44 px">
        <Button variant="primary" icon="plus">Add student</Button>
        <Button icon="download">Export</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="subtle">Open trials</Button>
        <Button variant="danger" icon="trash">Delete 3 students</Button>
        <Button variant="primary" disabled>Saving…</Button>
        <Button icon="columns" aria-label="Choose columns" />
      </Row>
      <Row label="Buttons · 36 px">
        <Button variant="primary" size="sm">Mark now</Button>
        <Button size="sm">Retry</Button>
        <Button variant="ghost" size="sm">Clear all</Button>
        <Button variant="ghost" size="sm" icon="more" aria-label="Actions for Bekzod Jo'rayev" />
      </Row>
      <Row label="Badges · icon + word">
        <Badge tone="positive" dot>Active</Badge>
        <Badge tone="attention" icon="clock">Late 15:20</Badge>
        <Badge tone="critical" icon="x">Absent</Badge>
        <Badge tone="info" icon="userplus">Trial</Badge>
        <Badge tone="frozen" icon="snow">Frozen for debt</Badge>
        <Badge tone="neutral" icon="logout">Left</Badge>
        <Badge tone="line" icon="link">lc-up linked</Badge>
        <Badge tone="info" size="lg">Student</Badge>
      </Row>
      <Row label="Checkboxes">
        <Checkbox label="Sample ticked" checked={ticks.a} onChange={() => setTicks((t) => ({ ...t, a: !t.a }))} />
        <Checkbox label="Sample empty" checked={ticks.b} onChange={() => setTicks((t) => ({ ...t, b: !t.b }))} />
        <Checkbox label="Sample some" checked={false} indeterminate onChange={() => undefined} />
        <Checkbox label="Sample disabled" checked={false} disabled onChange={() => undefined} />
      </Row>
      <Row label="Chip bar">
        <span className={chipClass(true)}>
          All <ChipCount n={29} on />
        </span>
        <span className={chipClass(false)}>
          <Icon name="wallet" size="sm" className="text-ms-critical-fg" />
          Owes <ChipCount n={9} />
        </span>
        <span className={chipClass(false, true)}>
          Sergeli <ChipCount n={0} />
        </span>
        <FilterChip label="Branch: Chilonzor" onRemove={() => undefined} />
      </Row>
      <Row label="Search">
        <SearchField value="" placeholder="Name, phone or username" onSearch={() => undefined} className="max-w-[340px]" />
      </Row>
      <div className="flex flex-col gap-2.5">
        <span className="text-ms-over text-ms-fg-3">Pages</span>
        <div className="rounded-ms-ctl border border-ms-border">
          <Pagination
            page={2}
            pages={9}
            count={219}
            pageSize={25}
            pageSizes={[25, 50, 100]}
            noun={{ singular: "student", plural: "students" }}
            hrefFor={(p) => `#page-${p}`}
            onPage={() => undefined}
            onPageSize={() => undefined}
          />
        </div>
      </div>
      <Row label="Bulk bar">
        <BulkBar count={2} onClear={() => undefined}>
          <button type="button" className={bulkButtonClass}>
            <Icon name="msg" size="sm" />
            Send SMS
          </button>
          <button type="button" className={bulkButtonClass}>
            <Icon name="snow" size="sm" />
            Freeze
          </button>
          <button type="button" className={bulkButtonClass}>
            <Icon name="trash" size="sm" />
            Delete…
          </button>
        </BulkBar>
      </Row>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-ms-ctl border border-ms-border">
          <EmptyState title="No students match" detail="Try another search, or clear the filters." action={<Button size="sm">Clear filters</Button>} />
        </div>
        <div className="self-start">
          <ErrorState what="students" onRetry={() => undefined} />
        </div>
      </div>
    </div>
  );
}
