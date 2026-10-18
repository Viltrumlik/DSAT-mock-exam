"use client";

/**
 * The SMS journal: every SMS the platform has sent — debt warnings, campaigns, tests — as a
 * Django-admin changelist on `messages/`. The server searches (phone, text, the student's name,
 * the lc-up name), filters with counts (kind, status, when) and pages; the list's state sits in
 * the address beside `?tab=journal`, so a pasted link opens the same page of the same list.
 *
 * A row opens the whole message in a drawer: the full text, eskiz's request id (what eskiz's
 * support asks for), the error and the campaign it belonged to.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Badge, Drawer } from "@/components/ui";
import { ChangeList, type ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import { useChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import { dateTime, kindLabel, statusBadge } from "./format";
import { CAPTION_TEXT, TEXT_BUTTON } from "./panelKit";
import { MESSAGE_FILTER_KEYS, type SmsMessage } from "./smsApi";
import { useSmsMessages } from "./smsHooks";
import { campaignHref } from "./smsTabs";

const Muted = ({ children }: { children: ReactNode }) => <span className="text-muted-foreground">{children}</span>;

function StatusCell({ m }: { m: SmsMessage }) {
  const badge = statusBadge(m.status);
  return (
    <span title={m.eskiz_status ? `eskiz: ${m.eskiz_status}` : undefined}>
      <Badge variant={badge.variant}>{badge.label}</Badge>
    </span>
  );
}

const COLUMNS: ChangeListColumn<SmsMessage>[] = [
  { key: "time", label: "Time", render: (m) => dateTime(m.created_at) },
  {
    key: "recipient",
    label: "Recipient",
    render: (m) => (
      <span className="inline-flex max-w-[18rem] items-baseline gap-1.5">
        <span className="truncate">{m.user?.name || "—"}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{m.phone}</span>
      </span>
    ),
  },
  { key: "kind", label: "Kind", render: (m) => kindLabel(m.kind) },
  { key: "status", label: "Status", render: (m) => <StatusCell m={m} /> },
  { key: "parts", label: "Parts", className: "text-right", render: (m) => <span className="tabular-nums">{m.parts}</span> },
  {
    key: "text",
    label: "Text",
    render: (m) => (
      <span title={m.text} className="block max-w-[24rem] truncate">
        {m.text}
      </span>
    ),
  },
  { key: "by", label: "By", render: (m) => m.created_by_name || <Muted>—</Muted> },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 border-b border-border py-1.5 text-[13px] last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

function MessageDrawer({ m, onClose }: { m: SmsMessage; onClose: () => void }) {
  return (
    <Drawer open onClose={onClose} title={`SMS #${m.id}`} width={480}>
      <div className="space-y-4">
        <div>
          <p className={`${CAPTION_TEXT} mb-1`}>The text</p>
          <p className="whitespace-pre-wrap border border-border bg-surface-2 px-3 py-2 text-[13px]">{m.text}</p>
        </div>
        <dl>
          <Row label="Status">
            <StatusCell m={m} />
            {m.eskiz_status ? <Muted> eskiz: {m.eskiz_status}</Muted> : null}
          </Row>
          <Row label="To">
            {m.user?.name || "—"} <Muted>{m.phone}</Muted>
            {m.lcup_student_id ? <Muted> · lc-up #{m.lcup_student_id}</Muted> : null}
          </Row>
          <Row label="Kind">{kindLabel(m.kind)}</Row>
          <Row label="Created">{dateTime(m.created_at)}</Row>
          <Row label="Sent">{dateTime(m.sent_at)}</Row>
          <Row label="Parts">{m.parts}</Row>
          <Row label="Request id">
            {m.request_id ? <span className="font-mono text-[12px]">{m.request_id}</span> : <Muted>—</Muted>}
          </Row>
          <Row label="By">{m.created_by_name || <Muted>The system</Muted>}</Row>
          {m.campaign_id ? (
            <Row label="Campaign">
              <Link href={campaignHref(m.campaign_id)} className={TEXT_BUTTON}>
                Campaign #{m.campaign_id}
              </Link>
            </Row>
          ) : null}
          {m.error ? (
            <Row label="Error">
              <span className="text-danger-foreground">{m.error}</span>
            </Row>
          ) : null}
        </dl>
      </div>
    </Drawer>
  );
}

export function JournalPanel() {
  const { params } = useChangeListParams(MESSAGE_FILTER_KEYS);
  const query = useSmsMessages(params);
  const [open, setOpen] = useState<SmsMessage | null>(null);

  return (
    <>
      <ChangeList<SmsMessage>
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
        rowLabel={(m) => `${m.user?.name || m.phone} ${dateTime(m.created_at)}`}
      />
      {open ? <MessageDrawer m={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
