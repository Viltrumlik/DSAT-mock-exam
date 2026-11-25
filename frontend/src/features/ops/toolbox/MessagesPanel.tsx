"use client";

import { useState } from "react";

import { SearchField, buttonClass } from "@/features/console/ui";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import { stampText } from "./format";
import type { Channel } from "./toolboxApi";
import { useCapturedMessages, useClearMessages } from "./toolboxHooks";
import { CARD, CONTROL, ErrorLine, TD, TH } from "./ui";

const CHANNELS: { id: Channel | ""; label: string }[] = [
  { id: "", label: "Every channel" },
  { id: "sms", label: "SMS" },
  { id: "telegram", label: "Telegram" },
  { id: "email", label: "E-mail" },
  { id: "push", label: "Push" },
];
const CHANNEL_LABEL: Record<Channel, string> = { sms: "SMS", telegram: "Telegram", email: "E-mail", push: "Push" };

/** What the copy would have sent: every SMS, Telegram message, e-mail and push, newest first. Nothing reached anyone. */
export function MessagesPanel() {
  const [channel, setChannel] = useState<Channel | "">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const messages = useCapturedMessages({ channel, q, page });
  const clear = useClearMessages();
  const data = messages.data;
  const button = buttonClass({ variant: "secondary", size: "sm" });

  function clearAll() {
    if (!window.confirm("Delete every captured message? They are only the copy's record of what it would have sent.")) return;
    clear.mutate(undefined, { onSuccess: () => setPage(1) });
  }

  return (
    <section className={cn(CARD, "flex flex-col gap-3 p-4")} aria-labelledby="tb-messages">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="tb-messages" className="text-[15px] font-semibold text-ms-fg">
          Messages{data ? <span className="font-normal text-ms-fg-2"> · {data.count}</span> : null}
        </h2>
        <button type="button" disabled={clear.isPending || !data?.count} onClick={clearAll} className={buttonClass({ variant: "danger", size: "sm" })}>
          Clear all
        </button>
      </div>
      <div role="search" aria-label="Filter the messages" className="flex flex-col gap-2 sm:flex-row">
        <select
          aria-label="Channel"
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value as Channel | "");
            setPage(1);
          }}
          className={cn(CONTROL, "sm:w-48")}
        >
          {CHANNELS.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        <SearchField
          value={q}
          placeholder="Phone, chat, address or name"
          onSearch={(text) => {
            setQ(text);
            setPage(1);
          }}
          className="sm:max-w-sm sm:flex-1"
        />
      </div>
      {messages.error ? <ErrorLine>{formatApiErrorForToast(messages.error)}</ErrorLine> : null}
      {clear.error ? <ErrorLine>{formatApiErrorForToast(clear.error)}</ErrorLine> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-ms-fg">
          <caption className="sr-only">Captured messages, newest first</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>When</th>
              <th scope="col" className={TH}>Channel</th>
              <th scope="col" className={TH}>To</th>
              <th scope="col" className={TH}>Message</th>
            </tr>
          </thead>
          <tbody>
            {(data?.results ?? []).map((m) => (
              <tr key={m.id}>
                <td className={cn(TD, "whitespace-nowrap tabular-nums")}>{stampText(m.created_at)}</td>
                <td className={cn(TD, "whitespace-nowrap")}>{CHANNEL_LABEL[m.channel] ?? m.channel}</td>
                <td className={cn(TD, "max-w-[14rem] break-words tabular-nums")}>{m.to || "—"}</td>
                <td className={TD}>
                  {m.subject ? <div className="font-semibold">{m.subject}</div> : null}
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && !data.count ? <p className="text-[14px] text-ms-fg-2">Nothing captured{q || channel ? " that matches" : " yet"}.</p> : null}
      {data && data.pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-[14px] text-ms-fg-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className={button}>Newer</button>
          <span>Page {data.page} of {data.pages}</span>
          <button type="button" disabled={page >= data.pages} onClick={() => setPage(page + 1)} className={button}>Older</button>
        </div>
      ) : null}
    </section>
  );
}
