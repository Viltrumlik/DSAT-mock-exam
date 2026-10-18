"use client";

/**
 * A new text for eskiz to moderate. Once eskiz approves it, it shows up in the template list on
 * the next refresh as a pattern with %w / %d slots, and can be sent. Submitting costs nothing, so
 * it does not ask first; eskiz decides, and its refusal is shown in its own words.
 *
 * The counter counts as eskiz bills: one character outside plain Latin and every SMS of the
 * template is 70 characters a part instead of 160.
 */

import { useId, useState } from "react";

import { useToast } from "@/components/ToastProvider";
import { Alert, Button, Field, Modal, Textarea } from "@/components/ui";
import { isAscii, plural, smsParts } from "./format";
import { errorText } from "./panelKit";
import { useSubmitTemplate } from "./smsHooks";

/** The server's limit (sms/eskiz_templates.submit). */
export const TEMPLATE_MAX = 1000;

export function SubmitTemplateModal({ onClose }: { onClose: () => void }) {
  const uid = useId();
  const { push } = useToast();
  const submit = useSubmitTemplate();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const length = Array.from(trimmed).length;
  const parts = smsParts(trimmed);
  const latin = isAscii(trimmed);

  const send = () => {
    setError(null);
    if (!trimmed) return setError("Write the text first.");
    if (length > TEMPLATE_MAX) return setError(`eskiz takes up to ${TEMPLATE_MAX} characters; this is ${length}.`);
    if (!/\p{L}/u.test(trimmed)) return setError("The text needs at least one letter.");
    submit.mutate(trimmed, {
      onSuccess: (r) => {
        push({
          tone: "success",
          message: r?.template ? `Sent to eskiz moderation as #${r.template.eskiz_id}.` : "Sent to eskiz moderation.",
        });
        onClose();
      },
      onError: (e) => setError(errorText(e, "eskiz didn't take it. Try again.")),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New template"
      description="eskiz moderates every new text before it can be sent."
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={send} loading={submit.isPending}>
            Send to moderation
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field
          label="Text"
          htmlFor={`${uid}-text`}
          hint={`${length}/${TEMPLATE_MAX} characters · ${plural(parts, "SMS part")}${latin ? "" : " · not plain Latin: 70 characters a part"}`}
        >
          <Textarea
            id={`${uid}-text`}
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="MASTER SAT'dan yozyabmiz. (STUDENT), …"
          />
        </Field>
        <p className="text-[13px] text-muted-foreground">
          Write (STUDENT) where the student&apos;s name goes, as lc-up&apos;s texts do — the panel then fills it in for
          each student. Plain Latin letters, with &apos; for oʻ and gʻ, keep an SMS at 160 characters a part.
        </p>
      </div>
    </Modal>
  );
}
