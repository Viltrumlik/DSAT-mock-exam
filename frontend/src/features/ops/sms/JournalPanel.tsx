"use client";

/**
 * The SMS journal (plan 2026-11-01-sms-v2, Task 9): every SMS the platform has sent, as a
 * Django-admin changelist on `messages/`, grouped by day. The server searches (phone, text, the
 * student's name, the lc-up name), filters with counts (kind, status, when, operator, group,
 * teacher, template, campaign) and pages; the dates and every filter sit in the address beside
 * `?tab=journal`, so a pasted link opens the same list. The chosen filters show as chips above it.
 *
 * Each SMS says where it stands in words ("Operator rejected"), and a row opens its story in a
 * drawer — with Resend when it did not arrive. Export writes the whole filtered list as a CSV.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { useToast } from "@/components/ui";
import { ChangeList, type ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import { buttonClass } from "@/features/console/ui";
import { useChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import { downloadBlob } from "@/lib/download";
import { DateRangeFilter } from "./DateRangeFilter";
import { dayLabel, firstLine, todayInTashkent } from "./format";
import { OperatorDot, StatusPill } from "./look";
import { MessageDrawer } from "./MessageDrawer";
import { MESSAGE_FILTER_KEYS, smsApi, type SmsMessage } from "./smsApi";
import { useSmsMessages, useSmsOverview } from "./smsHooks";

const Muted = ({ children }: { children: ReactNode }) => <span className="text-ms-fg-3">{children}</span>;

const time = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** The Tashkent day an SMS was written on: the journal's groups. */
const dayOf = (m: SmsMessage) => todayInTashkent(new Date(m.created_at));

function dayHeading(day: string): string {
  const today = todayInTashkent();
  if (day === today) return "Today";
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (day === yesterday) return "Yesterday";
  return dayLabel(day);
}

function Recipient({ m }: { m: SmsMessage }) {
  return (
    <span className="flex max-w-[16rem] flex-col leading-tight">
      {m.user ? (
        <Link
          href={`/ops/students/${m.user.id}?tab=sms`}
          onClick={(e) => e.stopPropagation()}
          className="truncate font-medium text-ms-fg hover:underline"
        >
          {m.user.name}
        </Link>
      ) : (
        <Muted>—</Muted>
      )}
      {m.groups.length ? <span className="truncate text-[12px] text-ms-fg-3">{m.groups.join(", ")}</span> : null}
    </span>
  );
}

const COLUMNS: ChangeListColumn<SmsMessage>[] = [
  { key: "time", label: "Time", render: (m) => time(m.created_at) },
  { key: "recipient", label: "Recipient", render: (m) => <Recipient m={m} /> },
  {
    key: "phone",
    label: "Phone",
    render: (m) => (
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <OperatorDot operator={m.operator} />
        {m.phone}
      </span>
    ),
  },
  { key: "source", label: "Source", render: (m) => <span className="block max-w-[14rem] truncate">{m.source.label}</span> },
  { key: "status", label: "Status", render: (m) => <StatusPill message={m} /> },
  {
    key: "text",
    label: "Text",
    render: (m) => (
      <span title={m.text} className="block max-w-[14rem] truncate text-ms-fg-3">
        {m.text}
      </span>
    ),
  },
];

function Card({ m }: { m: SmsMessage }) {
  return (
    <span className="block space-y-1 text-[13px]">
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{m.user?.name || m.phone}</span>
        <Muted>{time(m.created_at)}</Muted>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <StatusPill message={m} />
        <OperatorDot operator={m.operator} />
        <Muted>{m.source.label}</Muted>
      </span>
      <span className="block truncate text-ms-fg-3">{firstLine(m.text, 80)}</span>
    </span>
  );
}

export function JournalPanel() {
  const { params, update } = useChangeListParams(MESSAGE_FILTER_KEYS);
  const query = useSmsMessages(params);
  const price = useSmsOverview().data?.price_per_part ?? 0;
  const toast = useToast();
  const [open, setOpen] = useState<SmsMessage | null>(null);
  const [exporting, setExporting] = useState(false);

  const from = params.filters.from ?? "";
  const to = params.filters.to ?? "";
  const facets = query.data?.filters ?? [];
  const chips: { key: string; label: string }[] = [];
  for (const key of MESSAGE_FILTER_KEYS) {
    const value = params.filters[key];
    if (!value || key === "resendable") continue;
    if (key === "from") chips.push({ key, label: `From ${dayLabel(value)}` });
    else if (key === "to") chips.push({ key, label: `To ${dayLabel(value)}` });
    else {
      const facet = facets.find((f) => f.key === key);
      const option = facet?.options.find((o) => o.value === value);
      chips.push({ key, label: `${facet?.label ?? key}: ${option?.label ?? value}` });
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const blob = await smsApi.exportMessages(params);
      downloadBlob(blob, `sms-journal-${todayInTashkent()}.csv`);
    } catch {
      toast({ tone: "danger", title: "The export didn't download", description: "Try again in a moment." });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <ChangeList<SmsMessage>
        // The dates are no facet, so the journal names its own chips; the list removes and clears them.
        filterChips={chips}
        title="Journal"
        noun={{ singular: "SMS", plural: "SMS" }}
        columns={COLUMNS}
        data={query.data}
        loading={query.isPending}
        error={query.isError}
        fetching={query.isFetching && query.isPlaceholderData}
        onRetry={() => void query.refetch()}
        filterKeys={MESSAGE_FILTER_KEYS}
        onRowClick={setOpen}
        searchPlaceholder="Search phone, name or text"
        rowLabel={(m) => `${m.user?.name || m.phone} ${m.created_at}`}
        groupBy={dayOf}
        groupLabel={dayHeading}
        mobileCard={(m) => <Card m={m} />}
        headerAction={
          <span className="flex flex-wrap items-center gap-2">
            <DateRangeFilter from={from} to={to} onChange={(range) => update(range)} />
            <button type="button" className={buttonClass({ variant: "secondary" })} disabled={exporting} onClick={() => void exportCsv()}>
              {exporting ? "Exporting…" : "Export"}
            </button>
          </span>
        }
      />
      {open ? <MessageDrawer m={open} pricePerPart={price} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
