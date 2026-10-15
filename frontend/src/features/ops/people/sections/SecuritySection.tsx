"use client";

import { formatDate, formatLastSeen } from "@/features/ops/users/peopleColumns";
import { Fieldset, PartBody, Row, SubHeading, Table, Td } from "../Fieldset";
import { formatDateTime } from "../format";
import { usePersonPart, type PersonSecurity } from "../personApi";

/** How the account signs in, and every device signed in now. "Log out everywhere" is in the header. */

export function SecuritySection({ id }: { id: number }) {
  const query = usePersonPart<PersonSecurity>(id, "security");
  return (
    <Fieldset title="Security">
      <PartBody
        query={query}
        isEmpty={() => false}
        render={(d) => (
          <>
            <div>
              <Row label="Telegram">{d.telegram_linked ? "Linked" : "Not linked"}</Row>
              <Row label="Email verified">{d.email_verified ? "Yes" : "No"}</Row>
              <Row label="Password changed">{d.last_password_change ? formatDate(d.last_password_change) : "Never"}</Row>
            </div>
            <div className="mt-4">
              <SubHeading>Signed-in devices</SubHeading>
              {d.sessions.length === 0 ? (
                <p className="text-muted-foreground">No signed-in devices</p>
              ) : (
                <Table head={["Device", "IP", "Signed in", "Last active"]}>
                  {d.sessions.map((s) => (
                    <tr key={s.id}>
                      <Td className="max-w-[20rem] truncate">
                        <span title={s.device}>{s.device}</span>
                      </Td>
                      <Td className="tabular-nums text-muted-foreground">{s.ip || "—"}</Td>
                      <Td className="tabular-nums text-muted-foreground">{formatDateTime(s.created_at)}</Td>
                      <Td className="tabular-nums text-muted-foreground">
                        {s.last_seen_at ? formatLastSeen(s.last_seen_at) : "—"}
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          </>
        )}
      />
    </Fieldset>
  );
}
