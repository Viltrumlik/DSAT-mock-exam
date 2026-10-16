"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { Badge } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/cn";
import { Fieldset, PartBody, Table, Td, TONE_TEXT, WIDE_ONLY } from "@/features/ops/people/Fieldset";
import {
  classroomKeys,
  removeTelegramMember,
  serverReason,
  useClassroomPart,
  type ClassroomTelegram,
  type ClassroomTelegramMember,
} from "../classroomsApi";

const STATUS: Record<ClassroomTelegramMember["status"], { label: string; variant: "success" | "info" | "neutral" }> = {
  JOINED: { label: "In the group", variant: "success" },
  PENDING: { label: "Invite sent", variant: "info" },
  LEFT: { label: "Left", variant: "neutral" },
  REMOVED: { label: "Removed", variant: "neutral" },
};

/**
 * The class Telegram group (plan 2026-10-16): who is in it, which of them the bot looks after by
 * itself, who is frozen — and a Remove for the people the bot never will (members from before it
 * who have not signed in, accounts it cannot place). The owner's decision: those are the admin's
 * to remove by hand, once.
 */
export function TelegramSection({ id }: { id: number }) {
  const query = useClassroomPart<ClassroomTelegram>(id, "telegram");
  const qc = useQueryClient();
  const { push } = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  const remove = async (m: ClassroomTelegramMember) => {
    setBusy(m.id);
    try {
      await removeTelegramMember(id, m.id);
      push({ tone: "success", message: `Removed ${m.name || m.telegram_display_name || "them"} from the Telegram group.` });
    } catch (e: unknown) {
      push({ tone: "error", message: serverReason(e, "Telegram did not remove them.") });
    } finally {
      // Reload on a refusal too: a 409 can follow a changed row (someone already out is now marked REMOVED).
      await qc.invalidateQueries({ queryKey: classroomKeys.part(id, "telegram") });
      setBusy(null);
    }
  };

  return (
    <Fieldset title="Telegram" icon={Send} description="The class group: who is in it and who the bot looks after">
      <PartBody
        query={query}
        isEmpty={() => false}
        render={(d) =>
          !d.configured ? (
            <p className="text-sm text-muted-foreground">
              No Telegram group is set for this class. Add the bot to the group as an admin (Invite users + Ban
              users), send /chatid there, and paste the id into the class form.
            </p>
          ) : (
            <>
              {d.health?.problem ? (
                <p className={cn("mb-4 text-sm font-medium", TONE_TEXT.danger)}>{d.health.problem}</p>
              ) : null}
              <p className="mb-4 text-sm text-muted-foreground">
                {d.counts.in_group ?? "?"} in the group (bot and admins included) · {d.counts.known} known here ·{" "}
                {d.counts.managed} looked after by the bot · {d.counts.frozen_in_group} frozen
              </p>
              <Table head={["Person", { label: "Telegram", className: WIDE_ONLY }, "Status", ""]}>
                {d.members.map((m) => (
                  <tr key={m.id}>
                    <Td wrap className="font-medium">
                      {m.name || <span className="text-muted-foreground">Not a MasterSAT account</span>}
                      {m.frozen ? (
                        <Badge variant={m.frozen_for_debt ? "danger" : "warning"} className="ml-2">
                          {m.frozen_for_debt ? "Frozen — unpaid" : "Frozen"}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className={WIDE_ONLY}>
                      {m.telegram_username ? `@${m.telegram_username}` : m.telegram_display_name || "—"}
                    </Td>
                    <Td>
                      <Badge variant={STATUS[m.status].variant}>{STATUS[m.status].label}</Badge>
                      {m.status === "JOINED" && !m.managed ? (
                        <span className="ml-2 text-xs text-muted-foreground">bot will not remove</span>
                      ) : null}
                    </Td>
                    <Td>
                      {m.status === "JOINED" ? (
                        <button
                          type="button"
                          disabled={busy === m.id}
                          onClick={() => remove(m)}
                          className={cn("text-sm font-medium hover:underline disabled:opacity-50", TONE_TEXT.danger)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </Table>
            </>
          )
        }
      />
    </Fieldset>
  );
}
