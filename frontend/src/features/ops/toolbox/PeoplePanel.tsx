"use client";

import { useState } from "react";

import { SearchField, buttonClass, signedAmount } from "@/features/console/ui";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import { stampText } from "./format";
import type { SeatStatus, ToolboxPerson } from "./toolboxApi";
import { useMakeStudents, useSetBalance, useSignInLink, useToolboxGroups, useToolboxPeople } from "./toolboxHooks";
import { CARD, CONTROL, DoneLine, ErrorLine, LABEL, TD, TH } from "./ui";

/** The balances the toolbox offers with one click: none, one lesson, one so'm in debt. */
const BALANCE_PRESETS = [0, 38_500, -1] as const;

function TestStudentForm() {
  const groups = useToolboxGroups();
  const make = useMakeStudents();
  const [groupId, setGroupId] = useState("");
  const [status, setStatus] = useState<SeatStatus>("trial");
  const [firstPayment, setFirstPayment] = useState(false);
  const button = buttonClass({ variant: "secondary", size: "sm" });

  function submit(count: number) {
    if (!groupId) return;
    make.mutate({ classroom_id: Number(groupId), status, count, first_payment: status === "active" && firstPayment });
  }

  return (
    <section className={cn(CARD, "flex flex-col gap-3 p-4")} aria-labelledby="tb-student">
      <h2 id="tb-student" className="text-[15px] font-semibold text-ms-fg">Test student</h2>
      <p className="text-[14px] text-ms-fg-2">
        Made by the same code as New student: a TEST name, a made-up phone and a parent&apos;s phone.
      </p>
      <label className={LABEL}>
        Group
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={CONTROL}>
          <option value="">Choose a group</option>
          {(groups.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-wrap gap-4 text-[14px] text-ms-fg">
        <legend className="mb-1 text-[13px] text-ms-fg-2">Status</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="tb-status" checked={status === "trial"} onChange={() => setStatus("trial")} /> Demo
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="tb-status" checked={status === "active"} onChange={() => setStatus("active")} /> Paying
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={status !== "active"} checked={firstPayment} onChange={(e) => setFirstPayment(e.target.checked)} />
          First payment
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!groupId || make.isPending} onClick={() => submit(1)} className={button}>Add one</button>
        <button type="button" disabled={!groupId || make.isPending} onClick={() => submit(5)} className={button}>Add 5</button>
      </div>
      {make.error ? <ErrorLine>{formatApiErrorForToast(make.error)}</ErrorLine> : null}
      {make.data ? (
        <DoneLine>
          Made {make.data.students.length}:
          <ul className="mt-1">
            {make.data.students.map((s) => (
              <li key={s.id}>
                {s.name} — {s.phone}, parent {s.parent_phone || "—"}
                {s.balance !== null ? `, balance ${signedAmount(s.balance)}` : ""}
              </li>
            ))}
          </ul>
        </DoneLine>
      ) : null}
    </section>
  );
}

function BalanceForm({ person }: { person: ToolboxPerson }) {
  const save = useSetBalance();
  const [target, setTarget] = useState("");
  const button = buttonClass({ variant: "secondary", size: "sm" });
  const send = (value: number) => save.mutate({ user_id: person.id, target: value });
  const typed = Number(target.replace(/[\s,]/g, "").replace("−", "-"));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {BALANCE_PRESETS.map((value) => (
          <button key={value} type="button" disabled={save.isPending} onClick={() => send(value)} className={button}>
            {signedAmount(value)}
          </button>
        ))}
        <label className={LABEL}>
          Exact balance
          <input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} className={cn(CONTROL, "w-36")} />
        </label>
        <button
          type="button"
          disabled={save.isPending || !target.trim() || !Number.isInteger(typed)}
          onClick={() => send(typed)}
          className={button}
        >
          Set
        </button>
      </div>
      {save.error ? <ErrorLine>{formatApiErrorForToast(save.error)}</ErrorLine> : null}
      {save.data ? <DoneLine>The balance is now {signedAmount(save.data.balance)} so’m.</DoneLine> : null}
    </div>
  );
}

function SignInAs({ person }: { person: ToolboxPerson }) {
  const link = useSignInLink();
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={link.isPending}
        onClick={() => link.mutate(person.id)}
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        Make a sign-in link
      </button>
      {link.error ? <ErrorLine>{formatApiErrorForToast(link.error)}</ErrorLine> : null}
      {link.data ? (
        <DoneLine>
          <a href={link.data.url} target="_blank" rel="noreferrer" className="font-semibold underline">
            Open as {person.name}
          </a>{" "}
          — works once, until {stampText(link.data.expires_at)}.
        </DoneLine>
      ) : null}
    </div>
  );
}

function PersonTools() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<{ id: number; tool: "balance" | "sign-in" } | null>(null);
  const people = useToolboxPeople(q);
  const button = buttonClass({ variant: "ghost", size: "sm" });
  const rows = q.trim().length >= 2 ? people.data ?? [] : [];

  return (
    <section className={cn(CARD, "flex flex-col gap-3 p-4")} aria-labelledby="tb-person">
      <h2 id="tb-person" className="text-[15px] font-semibold text-ms-fg">Set a balance, or sign in as someone</h2>
      <SearchField value={q} placeholder="Name or phone" onSearch={setQ} />
      {people.error ? <ErrorLine>{formatApiErrorForToast(people.error)}</ErrorLine> : null}
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-ms-fg">
            <caption className="sr-only">People found</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Person</th>
                <th scope="col" className={TH}>Role</th>
                <th scope="col" className={cn(TH, "text-right")}>Balance</th>
                <th scope="col" className={cn(TH, "w-0")}><span className="sr-only">Tools</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className={TD}>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-[13px] tabular-nums text-ms-fg-3">{p.phone || "—"}{p.frozen ? " · frozen" : ""}</div>
                    {open?.id === p.id ? (
                      <div className="mt-2">{open.tool === "balance" ? <BalanceForm person={p} /> : <SignInAs person={p} />}</div>
                    ) : null}
                  </td>
                  <td className={TD}>{p.role}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{p.balance === null ? "—" : signedAmount(p.balance)}</td>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    <button type="button" disabled={p.balance === null} onClick={() => setOpen({ id: p.id, tool: "balance" })} className={button}>
                      Set balance
                    </button>
                    <button type="button" onClick={() => setOpen({ id: p.id, tool: "sign-in" })} className={button}>
                      Sign in as
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[14px] text-ms-fg-2">{q.trim().length >= 2 ? "Nobody found." : "Type two letters of a name, or digits of a phone."}</p>
      )}
    </section>
  );
}

/** Test students, a balance set exactly, and a one-time "Sign in as" link. */
export function PeoplePanel() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <TestStudentForm />
      <PersonTools />
    </div>
  );
}
