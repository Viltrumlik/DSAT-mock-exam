"use client";

import type { ReactNode } from "react";
import type { PeopleSection } from "@/features/ops/changelist/peopleApi";
import { formatDate } from "@/features/ops/users/peopleColumns";
import { cn } from "@/lib/cn";
import { Fieldset, PartBody, SubHeading, Table, Td, WIDE_ONLY, type Column } from "../Fieldset";
import { usePersonPart, type PersonResults } from "../personApi";

/**
 * Everything a learner has been graded on, newest first, and their XP and coins. A public user
 * has no classes, so they see only what is open to them: mock exams, practice tests and events.
 */

const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const percent = (p: number | null | undefined) => (p == null ? "—" : `${Math.round(p * 10) / 10}%`);
const yesNo = (v: boolean | null | undefined) => (v == null ? "—" : v ? "Yes" : "No");
/** A midterm's points out of its scale: "74 / 100", "650 / 800". */
const outOf = (score: number | null, scale: string) => (score == null ? "—" : `${score} / ${scale.includes("800") ? 800 : 100}`);

const EVENT_STATUS: Record<string, string> = { REGISTERED: "Registered", CANCELLED: "Cancelled" };
const EVENT_ATTENDED: Record<string, string> = { ATTENDED: "Yes", MISSED: "No" };

/** A column a phone does not show (see `WIDE_ONLY`). */
const wide = (label: string): Column => ({ label, className: WIDE_ONLY });

/** One heading and its table, or "Nothing yet" under it. */
function Part<T>({ title, rows, head, row }: { title: string; rows: T[]; head: Column[]; row: (r: T, i: number) => ReactNode }) {
  return (
    <div>
      <SubHeading>{title}</SubHeading>
      {rows.length === 0 ? <p className="text-muted-foreground">Nothing yet</p> : <Table head={head}>{rows.map(row)}</Table>}
    </div>
  );
}

/** A date cell; `wide` hides it on a phone, with its `wide(...)` header. */
const Day = ({ iso, wide: hide = false }: { iso: string | null; wide?: boolean }) => (
  <Td className={cn("tabular-nums text-muted-foreground", hide && WIDE_ONLY)}>{formatDate(iso)}</Td>
);
const Title = ({ children }: { children: ReactNode }) => <Td className="max-w-[12rem] truncate sm:max-w-[16rem]">{children}</Td>;

export function ResultsSection({ id, section }: { id: number; section: PeopleSection }) {
  const query = usePersonPart<PersonResults>(id, "results");
  const centre = section !== "public";

  return (
    <Fieldset title="Results">
      <PartBody
        query={query}
        isEmpty={() => false}
        render={(d) => (
          <div className="space-y-4">
            {centre ? (
              <>
                <Part
                  title="Homework"
                  rows={d.homework}
                  head={["Class", wide("Done"), "Rate"]}
                  row={(h) => (
                    <tr key={h.class_id}>
                      <Title>{h.class_name}</Title>
                      <Td className={`${WIDE_ONLY} tabular-nums`}>
                        {h.completed}/{h.total}
                      </Td>
                      <Td className="tabular-nums">{percent(h.rate)}</Td>
                    </tr>
                  )}
                />
                <Part
                  title="Overdue homework"
                  rows={d.overdue}
                  head={["Title", wide("Class"), "Due"]}
                  row={(o) => (
                    <tr key={o.id}>
                      <Title>{o.title}</Title>
                      <Td className={`${WIDE_ONLY} max-w-[14rem] truncate text-muted-foreground`}>{o.class_name}</Td>
                      <Day iso={o.due_at} />
                    </tr>
                  )}
                />
                <Part
                  title="Assessments"
                  rows={d.assessments}
                  head={["Title", "Score", wide("Date")]}
                  row={(a, i) => (
                    <tr key={i}>
                      <Title>{a.title}</Title>
                      <Td className="tabular-nums">{percent(a.percent)}</Td>
                      <Day iso={a.at} wide />
                    </tr>
                  )}
                />
              </>
            ) : null}
            <Part
              title="Mock exams"
              rows={d.mocks}
              head={["Title", wide("EN"), wide("Math"), "Total", wide("Date")]}
              row={(m, i) => (
                <tr key={i}>
                  <Title>{m.title}</Title>
                  <Td className={`${WIDE_ONLY} tabular-nums`}>{num(m.english)}</Td>
                  <Td className={`${WIDE_ONLY} tabular-nums`}>{num(m.math)}</Td>
                  <Td className="tabular-nums">{num(m.total)}</Td>
                  <Day iso={m.at} wide />
                </tr>
              )}
            />
            <Part
              title="Practice tests"
              rows={d.practice}
              head={["Title", "Score", wide("Date")]}
              row={(p, i) => (
                <tr key={i}>
                  <Title>{p.title}</Title>
                  <Td className="tabular-nums">{num(p.score)}</Td>
                  <Day iso={p.at} wide />
                </tr>
              )}
            />
            {centre ? (
              <Part
                title="Midterms"
                rows={d.midterms}
                head={["Title", "Score", wide("Passed"), wide("Date")]}
                row={(m, i) => (
                  <tr key={i}>
                    <Title>{m.title}</Title>
                    <Td className="tabular-nums">{outOf(m.score, m.scale)}</Td>
                    <Td className={WIDE_ONLY}>{yesNo(m.passed)}</Td>
                    <Day iso={m.at} wide />
                  </tr>
                )}
              />
            ) : null}
            <Part
              title="Events"
              rows={d.events}
              head={["Event", "Date", wide("Status"), wide("Attended")]}
              row={(e, i) => (
                <tr key={i}>
                  <Title>{e.title}</Title>
                  <Day iso={e.starts_at} />
                  <Td className={WIDE_ONLY}>{EVENT_STATUS[e.status] ?? e.status}</Td>
                  <Td className={WIDE_ONLY}>{e.attendance ? (EVENT_ATTENDED[e.attendance] ?? e.attendance) : "—"}</Td>
                </tr>
              )}
            />
            <p className="tabular-nums text-foreground">
              XP {num(d.rewards.xp)} · Coins {num(d.rewards.coins)}
            </p>
          </div>
        )}
      />
    </Fieldset>
  );
}
