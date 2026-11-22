"use client";

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CanonicalRole } from "@/lib/roles";
import { Tabs } from "@/features/console/ui";
import { NotKept } from "@/features/ops/detail/NotKept";
import { panelId, tabHref, tabId } from "@/features/ops/detail/tabs";
import { P, holds, type MeLike } from "@/features/ops/permissions";
import { EditCoinsDialog } from "./EditCoinsDialog";
import { EditStudentSheet } from "./EditStudentSheet";
import { PlainBoxes } from "./Fieldset";
import type { PersonCore } from "./personApi";
import { ProfileCard } from "./ProfileCard";
import { FIRST_PROFILE_TAB, PROFILE_TAB_LABEL, openProfileTab, profileTabCounts, profileTabsFor, type ProfileTab } from "./profileTabs";
import { TakePaymentSheet } from "./TakePaymentSheet";
import { AttendanceSection } from "./sections/AttendanceSection";
import { DiscountsSection } from "./sections/DiscountsSection";
import { GroupCards } from "./sections/GroupCards";
import { HistorySection } from "./sections/HistorySection";
import { PaymentsPanel } from "./sections/PaymentsPanel";
import { PurchasesSection } from "./sections/PurchasesSection";
import { ResultsSection } from "./sections/ResultsSection";
import { SecuritySection } from "./sections/SecuritySection";
import { SmsSection } from "./sections/SmsSection";

/**
 * A centre student's page in lc-up's shape, our look (StudentProfile / PhoneStudent boards, 22 Nov 2026): the
 * person on the left — photo, name, balance, Take payment, the facts — and lc-up's tabs on the right in lc-up's
 * order, then our own Attendance and Security. Every part the page had before is here: the account and parent
 * forms open from ✎, the old header's account actions sit behind ⋮, Results is split into Exams, Exercises and
 * Coins, and the lc-up link closes the Payments tab. A tab whose record this system does not keep says so.
 * On a phone the left card comes first and the tab row scrolls.
 */

type PayStep = { kind: "payment" | "refund" | "adjust"; group?: string };

export function StudentProfile({
  person,
  me,
  busy,
  mayChange,
  roles,
  notice,
  onChanged,
  onToggleFreeze,
  onOneTimePassword,
  onRevoke,
  onDelete,
}: {
  person: PersonCore;
  me: MeLike;
  busy: boolean;
  /** The viewer may change this account (`mayChangeAccount`): its actions and its form. */
  mayChange: boolean;
  roles: readonly CanonicalRole[];
  /** Said above both columns: the same-name accounts. */
  notice?: ReactNode;
  onChanged: () => void;
  onToggleFreeze: () => void;
  onOneTimePassword: () => void;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const tabs = profileTabsFor(me);
  const tab = openProfileTab(search.get("tab"), tabs);
  const counts = profileTabCounts(person);
  const [editing, setEditing] = useState(false);
  const [pay, setPay] = useState<PayStep | null>(null);
  const [adding, setAdding] = useState(false);
  const [coinsOpen, setCoinsOpen] = useState(false);

  const path = `/ops/${person.section}/${person.id}`;
  const openTab = (key: ProfileTab) =>
    router.replace(tabHref(path, new URLSearchParams(search.toString()), key, FIRST_PROFILE_TAB), { scroll: false });

  const ledger = person.ledger ?? null;
  const takes = holds(me, P.takePayment);
  const moneyOpen = Boolean(ledger?.payments_open);
  const payClosedReason = !ledger
    ? "This student has no account in the centre's ledger yet."
    : !ledger.payments_open
      ? "Payments are entered in lc-up until the cutover."
      : null;
  const canEditParent = Boolean(person.parent) && holds(me, P.editPeople);
  const canSms = holds(me, P.sendSms, P.sendDebtSms);
  const groupPay = moneyOpen && takes ? (group: string) => setPay({ kind: "payment", group }) : undefined;

  let body: ReactNode = null;
  if (tab === "groups") {
    body = (
      <GroupCards
        person={person}
        onChanged={onChanged}
        onAttendance={() => openTab("attendance")}
        onPay={groupPay}
        adding={adding}
        onAdding={setAdding}
      />
    );
  } else if (tab === "payments") body = <PaymentsPanel lcup={person.lcup} />;
  else if (tab === "notes") body = <NotKept>Notes are not kept in this system yet.</NotKept>;
  else if (tab === "discounts") body = <DiscountsSection accountId={ledger?.account_id ?? null} />;
  else if (tab === "exams") body = <ResultsSection id={person.id} section={person.section} target={person.sat.target_score} only="exams" />;
  else if (tab === "history") body = <HistorySection id={person.id} />;
  else if (tab === "purchases") body = <PurchasesSection id={person.id} />;
  else if (tab === "sms") body = <SmsSection id={person.id} />;
  else if (tab === "exercises") body = <ResultsSection id={person.id} section={person.section} only="exercises" />;
  else if (tab === "coins") {
    body = (
      <div className="flex flex-col gap-4">
        <ResultsSection id={person.id} section={person.section} only="rewards" />
        <NotKept>Crystals are not kept in this system yet.</NotKept>
      </div>
    );
  } else if (tab === "attendance") body = <AttendanceSection id={person.id} />;
  else if (tab === "security") {
    body = <SecuritySection id={person.id} person={person} onOneTimePassword={mayChange ? onOneTimePassword : undefined} />;
  }

  return (
    <div className="flex flex-col gap-5">
      {notice}
      <div className="flex flex-col gap-5 md:flex-row md:flex-wrap md:items-start">
        <ProfileCard
          person={person}
          actions={{
            busy,
            onEdit: mayChange || canEditParent ? () => setEditing(true) : undefined,
            onPay: moneyOpen && takes ? (kind) => setPay({ kind }) : undefined,
            refundOpen: moneyOpen && takes,
            adjustOpen: moneyOpen && holds(me, P.adjustBalance),
            payClosedReason,
            canTakePayment: takes,
            canMoney: holds(me, P.viewMoney),
            canSms,
            onEditCoins: holds(me, P.eventsShop) ? () => setCoinsOpen(true) : undefined,
            onAddToGroup:
              person.section === "students" && person.open_classes.length > 0
                ? () => {
                    setAdding(true);
                    openTab("groups");
                  }
                : undefined,
            onToggleFreeze: mayChange ? onToggleFreeze : undefined,
            onOneTimePassword: mayChange ? onOneTimePassword : undefined,
            onRevoke: mayChange ? onRevoke : undefined,
            onDelete: mayChange ? onDelete : undefined,
          }}
        />
        <section aria-label="Student sections" className="min-w-0 rounded-ms-card border border-ms-border bg-ms-card md:flex-[999_1_560px]">
          <Tabs<ProfileTab>
            label="Student sections"
            className="px-3"
            value={tab}
            onChange={openTab}
            tree
            ids={{ tab: (key) => tabId("person", key), panel: (key) => panelId("person", key) }}
            tabs={tabs.map((key) => ({ id: key, label: PROFILE_TAB_LABEL[key], count: counts[key]?.count, tone: counts[key]?.tone }))}
          />
          {/* Only the open tab is rendered, so only its part is fetched. */}
          <div role="tabpanel" id={panelId("person", tab)} aria-labelledby={tabId("person", tab)} className="min-w-0 p-4 md:p-5">
            <PlainBoxes>{body}</PlainBoxes>
          </div>
        </section>
      </div>

      <EditStudentSheet
        open={editing}
        onClose={() => setEditing(false)}
        person={person}
        onSaved={onChanged}
        readOnly={!mayChange}
        parentReadOnly={!holds(me, P.editPeople)}
        roles={roles}
      />
      {coinsOpen && person.coins != null ? (
        <EditCoinsDialog
          studentId={person.id}
          name={person.name || person.username}
          coins={person.coins}
          onClose={() => setCoinsOpen(false)}
          onDone={() => {
            setCoinsOpen(false);
            onChanged();
          }}
        />
      ) : null}
      {ledger && moneyOpen ? (
        <TakePaymentSheet
          open={pay !== null}
          onClose={() => setPay(null)}
          accountId={ledger.account_id}
          name={person.name || person.username}
          kind={pay?.kind ?? "payment"}
          groupName={pay?.group}
        />
      ) : null}
    </div>
  );
}
