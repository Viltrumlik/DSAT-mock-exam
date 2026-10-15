"use client";

import { KeyRound, Monitor, ShieldCheck, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatDate, formatLastSeen } from "@/features/ops/users/peopleColumns";
import { Fieldset, PartBody, Row, SubHeading, Table, Td, WIDE_ONLY } from "../Fieldset";
import { describeDevice } from "../device";
import { formatDateTime, formatPhone } from "../format";
import { ONE_TIME_PASSWORD_ROLES } from "../PersonHeader";
import { usePersonPart, type PersonCore, type PersonSecurity } from "../personApi";

/**
 * How the account signs in, the one-time password if one is open, and every device signed in now.
 * "Log out everywhere" is in the header's More menu.
 */

const PHONE_OS = /iOS|Android/;

function OneTimePasswordCard({ person, onOneTimePassword }: { person: PersonCore; onOneTimePassword: () => void }) {
  const otp = person.one_time_password;
  const lastFour = person.phone.replace(/\D/g, "").slice(-4);
  return (
    <div
      className={
        otp
          ? "flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft/40 p-4 sm:flex-row sm:items-center sm:justify-between"
          : "flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
      }
    >
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
          <KeyRound aria-hidden className="h-4 w-4 text-primary" />
          One-time password
          {otp ? (
            <Badge variant={otp.locked ? "danger" : otp.used ? "info" : "warning"}>
              {otp.locked ? "Locked after wrong tries" : otp.used ? "Used — choosing a password" : "Waiting to be used"}
            </Badge>
          ) : null}
        </p>
        <p className="text-sm text-muted-foreground">
          {otp
            ? `They sign in with ${formatPhone(person.phone)} and ${lastFour}, then choose a new password. Until ${formatDate(otp.expires_at)}.`
            : "Forgot their password? Remove it: they sign in once with their phone and its last four digits, then choose a new one."}
        </p>
      </div>
      <button
        type="button"
        onClick={onOneTimePassword}
        disabled={!person.phone}
        title={person.phone ? undefined : "Add a phone number first"}
        className="h-9 shrink-0 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground shadow-sm hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        {otp ? "Give a new one" : "Give one-time password"}
      </button>
    </div>
  );
}

export function SecuritySection({
  id,
  person,
  onOneTimePassword,
}: {
  id: number;
  person?: PersonCore;
  onOneTimePassword?: () => void;
}) {
  const query = usePersonPart<PersonSecurity>(id, "security");
  return (
    <Fieldset title="Security" icon={ShieldCheck} tone="info" description="How they sign in, and where they are signed in now">
      <PartBody
        query={query}
        isEmpty={() => false}
        render={(d) => (
          <div className="space-y-6">
            <div>
              <Row label="Telegram">
                {d.telegram_linked ? <Badge variant="success">Linked</Badge> : <Badge variant="outline">Not linked</Badge>}
              </Row>
              <Row label="Email verified">
                {d.email_verified ? <Badge variant="success">Yes</Badge> : <Badge variant="warning">No</Badge>}
              </Row>
              <Row label="Password changed">{d.last_password_change ? formatDate(d.last_password_change) : "Never"}</Row>
            </div>

            {person && onOneTimePassword && ONE_TIME_PASSWORD_ROLES.has(person.role) ? (
              <OneTimePasswordCard person={person} onOneTimePassword={onOneTimePassword} />
            ) : null}

            <div>
              <SubHeading>Signed-in devices</SubHeading>
              {d.sessions.length === 0 ? (
                <p className="rounded-lg bg-surface-2 px-4 py-3 text-muted-foreground">No signed-in devices</p>
              ) : (
                <Table head={["Device", { label: "IP", className: WIDE_ONLY }, { label: "Signed in", className: WIDE_ONLY }, "Last active"]}>
                  {d.sessions.map((s) => {
                    const name = describeDevice(s.device);
                    const Icon = PHONE_OS.test(name) ? Smartphone : Monitor;
                    return (
                      <tr key={s.id}>
                        <Td className="max-w-[12rem] truncate font-medium sm:max-w-[20rem]">
                          <span className="inline-flex items-center gap-2">
                            <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span title={s.device || undefined}>{name}</span>
                          </span>
                        </Td>
                        <Td className={`${WIDE_ONLY} tabular-nums text-muted-foreground`}>{s.ip || "—"}</Td>
                        <Td className={`${WIDE_ONLY} tabular-nums text-muted-foreground`}>{formatDateTime(s.created_at)}</Td>
                        <Td className="tabular-nums text-muted-foreground">
                          {s.last_seen_at ? formatLastSeen(s.last_seen_at) : "—"}
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </div>
          </div>
        )}
      />
    </Fieldset>
  );
}
