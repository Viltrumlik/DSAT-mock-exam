"use client";

/**
 * The SMS Overview: what the eskiz account has left, whether eskiz is answering, whether and when
 * the debt warning goes out next, and how the last days went — with a test SMS underneath, the
 * one way to see the whole chain work end to end.
 *
 * Two states mean nothing at all goes out, and each gets a warning above everything: eskiz has
 * no keys on this server, or the server's master switch holds the debt warning off whatever the
 * panel says.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { Alert, Badge } from "@/components/ui";
import { dayLabel, hourLabel, money, plural, splitCounts } from "./format";
import { LoadError, Loading, Section, TEXT_BUTTON } from "./panelKit";
import type { SmsOverview } from "./smsApi";
import { useSmsOverview } from "./smsHooks";
import { smsTabHref } from "./smsTabs";
import { TestSmsForm } from "./TestSmsForm";

function Card({ title, children, foot }: { title: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <Section title={title}>
      <div className="space-y-1 px-3 py-2.5 text-[13px]">
        {children}
        {foot ? <div className="text-muted-foreground">{foot}</div> : null}
      </div>
    </Section>
  );
}

const Figure = ({ children }: { children: ReactNode }) => (
  <p className="text-lg font-semibold tabular-nums text-foreground">{children}</p>
);

function debtOffReason(debt: SmsOverview["debt"]): string {
  if (!debt.env_enabled) return "the server's master switch is off";
  if (!debt.db_enabled) return "switched off on the Debt warnings tab";
  if (!debt.freeze_enabled) return "lc-up's debt freeze is off";
  return "";
}

function eskizBadge(eskiz: SmsOverview["eskiz"]) {
  if (eskiz.login_refused) return <Badge variant="danger">Login refused</Badge>;
  if (eskiz.token_cached) return <Badge variant="success">Signed in</Badge>;
  // No token yet is normal: the account logs in on the next send, and logins are kept rare.
  return <Badge variant="neutral">Signs in on the next send</Badge>;
}

export function OverviewPanel() {
  const overview = useSmsOverview();

  if (overview.isPending) return <Loading />;
  if (overview.isError || !overview.data) {
    return <LoadError what="overview" onRetry={() => void overview.refetch()} />;
  }

  const o = overview.data;
  const week = splitCounts(o.last7.total, o.last7.by_status);
  const today = splitCounts(o.today.total, o.today.by_status);
  const off = debtOffReason(o.debt);

  return (
    <div className="space-y-4">
      {!o.configured ? (
        <Alert tone="warning">
          eskiz is not configured on this server — no SMS can be sent. Its login goes in the server&apos;s environment.
        </Alert>
      ) : null}
      {!o.debt.env_enabled ? (
        <Alert tone="warning">
          The debt warning&apos;s master switch is off on this server (SMS_DEBT_WARNINGS_ENABLED) — no warning goes
          out, whatever the Debt warnings tab says.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Card title="Balance" foot={`${money(o.price_per_part)} per SMS part`}>
          {o.balance === null ? (
            <p className="text-muted-foreground">Couldn&apos;t ask eskiz just now.</p>
          ) : (
            <Figure>{money(o.balance)}</Figure>
          )}
        </Card>

        <Card title="Sender" foot="The name the SMS arrive from.">
          <Figure>{o.sender || "—"}</Figure>
        </Card>

        <Card title="eskiz" foot={o.eskiz.last_error ? `Last error: ${o.eskiz.last_error}` : "No errors."}>
          <p>{eskizBadge(o.eskiz)}</p>
        </Card>

        <Card
          title="Debt warning"
          foot={
            <Link href={smsTabHref("debt")} className={TEXT_BUTTON}>
              Debt warnings
            </Link>
          }
        >
          <p className="flex flex-wrap items-center gap-2">
            {o.debt.enabled ? <Badge variant="success">On</Badge> : <Badge variant="neutral">Off</Badge>}
            <span>{o.debt.enabled ? `Sends at ${hourLabel(o.debt.hour)}` : off}</span>
          </p>
          <p className="text-foreground">
            {o.debt.next_day
              ? `Next: ${dayLabel(o.debt.next_day)} · ${plural(o.debt.next_count, "student")}`
              : "No warning day ahead."}
          </p>
        </Card>

        <Card title="Last 7 days" foot={`${week.delivered} delivered · ${week.notDelivered} not delivered · ${week.other} other`}>
          <Figure>{plural(o.last7.total, "SMS", "SMS")}</Figure>
        </Card>

        <Card title="Today" foot={`${today.delivered} delivered · ${today.notDelivered} not delivered`}>
          <Figure>{plural(o.today.total, "SMS", "SMS")}</Figure>
        </Card>
      </div>

      <TestSmsForm pricePerPart={o.price_per_part} />
    </div>
  );
}
