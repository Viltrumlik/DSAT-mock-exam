"use client";

import type { ReactNode } from "react";
import {
  AlarmClock,
  BookCheck,
  CalendarHeart,
  ClipboardCheck,
  Coins,
  FileCheck2,
  GraduationCap,
  NotebookPen,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui";
import type { PeopleSection } from "@/features/ops/changelist/peopleApi";
import { formatDate } from "@/features/ops/users/peopleColumns";
import { cn } from "@/lib/cn";
import { Fieldset, IconSquare, PartBody, StatTile, Table, Td, TONE_TEXT, WIDE_ONLY, type Column, type Tone } from "../Fieldset";
import { rateTone } from "../PersonHeader";
import { usePersonPart, type PersonResults } from "../personApi";

/**
 * Everything a learner has been graded on, one card per kind, newest first, with their XP and
 * coins on top. A verdict is coloured — a score by how good it is, a pass or a fail, an attended
 * or a missed event — and work that is overdue stands out. A public user has no classes, so they
 * see only what is open to them: mock exams, practice tests and events.
 */

const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const percent = (p: number | null | undefined) => (p == null ? "—" : `${Math.round(p * 10) / 10}%`);
/** A midterm's points out of its scale: "74 / 100", "650 / 800". */
const outOf = (score: number | null, scale: string) => (score == null ? "—" : `${score} / ${scale.includes("800") ? 800 : 100}`);
/** A mock's total out of 1600: green from 1300, amber from 1000, red below. */
const satTone = (total: number | null): Tone =>
  total == null ? "neutral" : total >= 1300 ? "success" : total >= 1000 ? "warning" : "danger";

/** A column a phone does not show (see `WIDE_ONLY`). */
const wide = (label: string): Column => ({ label, className: WIDE_ONLY });

/** One kind of result: a card with its heading and table, or "Nothing yet" under it. */
function Part<T>({
  title,
  icon,
  tone = "primary",
  rows,
  head,
  row,
  highlight = false,
}: {
  title: string;
  icon: LucideIcon;
  tone?: Tone;
  rows: T[];
  head: Column[];
  row: (r: T, i: number) => ReactNode;
  highlight?: boolean;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border p-5",
        highlight && rows.length > 0 ? "border-warning/40 bg-warning-soft/30" : "border-border",
      )}
    >
      <h3 className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-foreground">
        <IconSquare icon={icon} tone={tone} size="sm" />
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet</p>
      ) : (
        <Table head={head}>{rows.map(row)}</Table>
      )}
    </section>
  );
}

/** A date cell; `wide` hides it on a phone, with its `wide(...)` header. */
const Day = ({ iso, wide: hide = false }: { iso: string | null; wide?: boolean }) => (
  <Td className={cn("tabular-nums text-muted-foreground", hide && WIDE_ONLY)}>{formatDate(iso)}</Td>
);
const Title = ({ children }: { children: ReactNode }) => (
  <Td className="max-w-[10rem] truncate font-medium sm:max-w-[16rem]">{children}</Td>
);
const Score = ({ children, tone }: { children: ReactNode; tone: Tone }) => (
  <Td className={cn("font-semibold tabular-nums", TONE_TEXT[tone])}>{children}</Td>
);

export function ResultsSection({ id, section }: { id: number; section: PeopleSection }) {
  const query = usePersonPart<PersonResults>(id, "results");
  const centre = section !== "public";

  return (
    <Fieldset title="Results" icon={Trophy} tone="accent" description="Everything graded, newest first">
      <PartBody
        query={query}
        isEmpty={() => false}
        render={(d) => (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2" data-testid="rewards">
              <StatTile label="XP" value={num(d.rewards.xp)} icon={Zap} tone="accent" sub="earned in total" />
              <StatTile label="Coins" value={num(d.rewards.coins)} icon={Coins} tone="warning" sub="to spend in the shop" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {centre ? (
                <>
                  <Part
                    title="Homework"
                    icon={BookCheck}
                    rows={d.homework}
                    head={["Class", wide("Done"), "Rate"]}
                    row={(h) => (
                      <tr key={h.class_id}>
                        <Title>{h.class_name}</Title>
                        <Td className={`${WIDE_ONLY} tabular-nums`}>
                          {h.completed}/{h.total}
                        </Td>
                        <Score tone={rateTone(h.rate)}>{percent(h.rate)}</Score>
                      </tr>
                    )}
                  />
                  <Part
                    title="Overdue homework"
                    icon={AlarmClock}
                    tone="warning"
                    highlight
                    rows={d.overdue}
                    head={["Title", wide("Class"), "Due"]}
                    row={(o) => (
                      <tr key={o.id}>
                        <Title>{o.title}</Title>
                        <Td className={`${WIDE_ONLY} max-w-[14rem] truncate text-muted-foreground`}>{o.class_name}</Td>
                        <Td className="tabular-nums font-medium text-warning-foreground">{formatDate(o.due_at)}</Td>
                      </tr>
                    )}
                  />
                  <Part
                    title="Assessments"
                    icon={ClipboardCheck}
                    rows={d.assessments}
                    head={["Title", "Score", wide("Date")]}
                    row={(a, i) => (
                      <tr key={i}>
                        <Title>{a.title}</Title>
                        <Score tone={rateTone(a.percent)}>{percent(a.percent)}</Score>
                        <Day iso={a.at} wide />
                      </tr>
                    )}
                  />
                </>
              ) : null}
              <Part
                title="Mock exams"
                icon={GraduationCap}
                rows={d.mocks}
                head={["Title", wide("EN"), wide("Math"), "Total", wide("Date")]}
                row={(m, i) => (
                  <tr key={i}>
                    <Title>{m.title}</Title>
                    <Td className={`${WIDE_ONLY} tabular-nums`}>{num(m.english)}</Td>
                    <Td className={`${WIDE_ONLY} tabular-nums`}>{num(m.math)}</Td>
                    <Score tone={satTone(m.total)}>{num(m.total)}</Score>
                    <Day iso={m.at} wide />
                  </tr>
                )}
              />
              <Part
                title="Practice tests"
                icon={FileCheck2}
                rows={d.practice}
                head={["Title", "Score", wide("Date")]}
                row={(p, i) => (
                  <tr key={i}>
                    <Title>{p.title}</Title>
                    <Td className="font-semibold tabular-nums">{num(p.score)}</Td>
                    <Day iso={p.at} wide />
                  </tr>
                )}
              />
              {centre ? (
                <Part
                  title="Midterms"
                  icon={NotebookPen}
                  rows={d.midterms}
                  head={["Title", "Score", wide("Passed"), wide("Date")]}
                  row={(m, i) => (
                    <tr key={i}>
                      <Title>{m.title}</Title>
                      <Td className="font-semibold tabular-nums">{outOf(m.score, m.scale)}</Td>
                      <Td className={WIDE_ONLY}>
                        {m.passed == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : m.passed ? (
                          <Badge variant="success">Yes</Badge>
                        ) : (
                          <Badge variant="danger">No</Badge>
                        )}
                      </Td>
                      <Day iso={m.at} wide />
                    </tr>
                  )}
                />
              ) : null}
              <Part
                title="Events"
                icon={CalendarHeart}
                tone="info"
                rows={d.events}
                head={["Event", "Date", wide("Status"), wide("Attended")]}
                row={(e, i) => (
                  <tr key={i}>
                    <Title>{e.title}</Title>
                    <Day iso={e.starts_at} />
                    <Td className={WIDE_ONLY}>
                      {e.status === "CANCELLED" ? (
                        <Badge variant="neutral">Cancelled</Badge>
                      ) : (
                        <Badge variant="primary">Registered</Badge>
                      )}
                    </Td>
                    <Td className={WIDE_ONLY}>
                      {e.attendance === "ATTENDED" ? (
                        <Badge variant="success">Yes</Badge>
                      ) : e.attendance === "MISSED" ? (
                        <Badge variant="danger">No</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                  </tr>
                )}
              />
            </div>
          </div>
        )}
      />
    </Fieldset>
  );
}
