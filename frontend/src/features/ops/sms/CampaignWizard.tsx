"use client";

/**
 * A new campaign, one decision a step: the template, what fills each of its slots, who gets it,
 * when — then the server's preview, and only then the send.
 *
 * Every slot of an eskiz template is filled one of three ways: the student's name as lc-up holds
 * it, their debt, or one text typed here and the same for everyone. The roles start from the
 * server's guess (its `(STUDENT)` placeholders) and can be changed.
 *
 * The preview is the server's: it resolves the audience and prices it, so the count and the cost
 * the confirm names are the ones it would send now. The recipients are worked out again when it
 * sends, so a scheduled debtors campaign leaves out anyone who has paid by then. The draft that
 * was previewed is the one created — any change goes back through the preview: Back is off while a
 * preview is on its way, and a preview that comes back for a draft since changed is dropped. The
 * last question names the template, who, when, the count and the cost.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { useToast } from "@/components/ToastProvider";
import { Alert, Button, Field, Input, Modal, SegmentedControl, Select } from "@/components/ui";
import { fromLocalInput } from "@/lib/datetimeLocal";
import {
  dateTime,
  defaultRoles,
  fillPattern,
  money,
  plural,
  roleLabel,
  sampleValues,
  slotLabel,
  smsParts,
  templateOption,
} from "./format";
import { CAPTION_TEXT, LoadError, SkippedList, errorText, paidErrorText } from "./panelKit";
import type {
  AudienceKind,
  AudienceStudent,
  CampaignDraft,
  CampaignPreview,
  EskizTemplate,
  SlotRole,
  TemplateSlot,
} from "./smsApi";
import {
  STUDENT_SEARCH_MIN,
  useAudienceClassrooms,
  useAudienceStudents,
  useCreateCampaign,
  usePreviewCampaign,
  useSmsTemplates,
} from "./smsHooks";

/** The server's cap on one campaign, checked at preview, at create and again at send. */
export const CAMPAIGN_LIMIT = 300;

const STEPS = ["Template", "Slots", "Who gets it", "When", "Preview"] as const;

/** A number slot cannot carry a name; a word slot can carry anything. */
export function rolesFor(slot: TemplateSlot): SlotRole[] {
  return slot.kind === "d" ? ["debt", "text"] : ["student", "debt", "text"];
}

function startingRoles(t: EskizTemplate): SlotRole[] {
  return defaultRoles(t.slots, t.guessed_roles).map((role, i) => (rolesFor(t.slots[i]).includes(role) ? role : "text"));
}

const Caption = ({ children }: { children: string }) => <p className={`${CAPTION_TEXT} mb-1`}>{children}</p>;
const Quote = ({ children }: { children: string }) => (
  <p className="whitespace-pre-wrap border border-border bg-surface-2 px-3 py-2 text-[13px]">{children}</p>
);

export function CampaignWizard({ onClose }: { onClose: () => void }) {
  const uid = useId();
  const { push } = useToast();
  const templates = useSmsTemplates();
  const classrooms = useAudienceClassrooms();
  const previewer = usePreviewCampaign();
  const creator = useCreateCampaign();
  const usable = useMemo(() => (templates.data?.templates ?? []).filter((t) => t.usable), [templates.data]);

  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [roles, setRoles] = useState<SlotRole[]>([]);
  const [texts, setTexts] = useState<string[]>([]);
  const [audience, setAudience] = useState<AudienceKind>("student");
  const [picked, setPicked] = useState<AudienceStudent[]>([]);
  const [search, setSearch] = useState("");
  const [classroomId, setClassroomId] = useState<number | null>(null);
  const [when, setWhen] = useState<"now" | "at">("now");
  const [at, setAt] = useState("");
  const [previewed, setPreviewed] = useState<{ draft: CampaignDraft; preview: CampaignPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const students = useAudienceStudents(audience === "student" ? search : "");

  const template = usable.find((t) => t.eskiz_id === templateId) ?? null;

  const chooseTemplate = (id: number) => {
    const t = usable.find((x) => x.eskiz_id === id);
    setTemplateId(t ? id : null);
    setRoles(t ? startingRoles(t) : []);
    setTexts(t ? t.slots.map(() => "") : []);
  };

  const setRole = (i: number, role: SlotRole) => setRoles(roles.map((r, j) => (j === i ? role : r)));
  const setText = (i: number, value: string) => setTexts(texts.map((t, j) => (j === i ? value : t)));
  const addStudent = (s: AudienceStudent) => {
    if (picked.length >= CAMPAIGN_LIMIT || picked.some((p) => p.id === s.id)) return;
    setPicked([...picked, s]);
  };

  const draftOf = (scheduledAt: string | null): CampaignDraft | null =>
    template
      ? {
          template_id: template.eskiz_id,
          slot_roles: roles,
          slot_texts: roles.map((r, i) => (r === "text" ? (texts[i] ?? "").trim() : "")),
          audience,
          audience_ids: audience === "student" ? picked.map((p) => p.id) : audience === "group" && classroomId ? [classroomId] : [],
          scheduled_at: scheduledAt,
        }
      : null;

  // What a preview must still match when it comes back: the draft as the steps now read.
  const currentKey = JSON.stringify(draftOf(when === "at" ? fromLocalInput(at) : null));
  const latestKey = useRef(currentKey);
  useEffect(() => {
    latestKey.current = currentKey;
  });

  const runPreview = () => {
    let scheduledAt: string | null = null;
    if (when === "at") {
      scheduledAt = fromLocalInput(at);
      if (!scheduledAt) return setError("Pick when it goes out.");
      if (new Date(scheduledAt).getTime() < Date.now() - 60_000) return setError("That time has passed — pick a later one.");
    }
    const draft = draftOf(scheduledAt);
    if (!draft) return setError("Pick a template.");
    previewer.mutate(draft, {
      onSuccess: (preview) => {
        if (JSON.stringify(draft) !== latestKey.current) return; // the draft changed meanwhile
        setPreviewed({ draft, preview });
        setStep(4);
      },
      onError: (e) => setError(errorText(e, "Couldn't preview it. Try again.")),
    });
  };

  const next = () => {
    setError(null);
    if (step === 0) {
      if (!template) return setError("Pick a template.");
    } else if (step === 1) {
      if (roles.some((r, i) => r === "text" && !(texts[i] ?? "").trim())) return setError("Fill in every text slot.");
    } else if (step === 2) {
      if (audience === "student" && picked.length === 0) return setError("Pick at least one student.");
      if (audience === "group" && !classroomId) return setError("Pick a class.");
    } else if (step === 3) {
      return runPreview();
    }
    setStep(step + 1);
  };

  const back = () => {
    setError(null);
    if (step === 4) setPreviewed(null);
    setStep(Math.max(0, step - 1));
  };

  /** "Debtors", "Group: <class>", "3 students" — who the last question names. */
  const audienceText = (draft: CampaignDraft): string => {
    if (draft.audience === "debtors") return "Debtors";
    if (draft.audience === "group") {
      const id = draft.audience_ids[0];
      return `Group: ${(classrooms.data ?? []).find((c) => c.id === id)?.name ?? `#${id}`}`;
    }
    return plural(draft.audience_ids.length, "student");
  };

  const send = () => {
    if (!previewed) return;
    const { draft, preview } = previewed;
    const what = `template #${draft.template_id} to ${audienceText(draft)}`;
    const figures = `${preview.count} SMS (~${money(preview.cost)})`;
    const question = draft.scheduled_at
      ? `Schedule ${what} for ${dateTime(draft.scheduled_at)}: ${figures}?`
      : `Send ${what} now: ${figures}?`;
    if (!window.confirm(question)) return;
    setError(null);
    creator.mutate(draft, {
      onSuccess: (created) => {
        push({
          tone: "success",
          message: draft.scheduled_at
            ? `Campaign #${created.id} is scheduled for ${dateTime(created.scheduled_at ?? draft.scheduled_at)}.`
            : `Campaign #${created.id} is sending now.`,
        });
        onClose();
      },
      onError: (e) => setError(paidErrorText(e, "Couldn't create the campaign. Try again.")),
    });
  };

  const sample = template ? fillPattern(template.pattern, sampleValues(roles, texts)) : "";
  const preview = previewed?.preview ?? null;
  const blocked = Boolean(preview && (preview.over_limit || preview.count === 0));
  const hits = (students.data ?? []).filter((s) => !picked.some((p) => p.id === s.id));

  const footer = (
    <>
      {step === 0 ? (
        <Button size="sm" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={back} disabled={previewer.isPending}>
          Back
        </Button>
      )}
      {step < 3 ? (
        <Button size="sm" onClick={next}>
          Next
        </Button>
      ) : step === 3 ? (
        <Button size="sm" onClick={next} loading={previewer.isPending}>
          Preview
        </Button>
      ) : (
        <Button size="sm" onClick={send} loading={creator.isPending} disabled={blocked}>
          {previewed?.draft.scheduled_at ? `Schedule for ${preview?.count ?? 0}` : `Send to ${preview?.count ?? 0}`}
        </Button>
      )}
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="New campaign"
      description={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`}
      footer={footer}
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {step === 0 ? (
          <>
            <Field label="Template" htmlFor={`${uid}-template`} hint="Only service and ad-price templates can be sent.">
              <Select
                id={`${uid}-template`}
                selectSize="sm"
                value={templateId ? String(templateId) : ""}
                onChange={(e) => chooseTemplate(Number(e.target.value))}
              >
                <option value="">Choose a template…</option>
                {usable.map((t) => (
                  <option key={t.eskiz_id} value={t.eskiz_id}>
                    {templateOption(t)}
                  </option>
                ))}
              </Select>
            </Field>
            {templates.isError ? (
              <LoadError what="template list" onRetry={() => void templates.refetch()} />
            ) : !templates.isPending && usable.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No usable template yet — refresh the list on the Templates tab.
              </p>
            ) : null}
            {template ? (
              <>
                <div>
                  <Caption>What eskiz approved</Caption>
                  <Quote>{template.pattern}</Quote>
                </div>
                <div>
                  <Caption>As it was written</Caption>
                  <Quote>{template.original || "—"}</Quote>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {step === 1 && template ? (
          <>
            {template.slots.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">This template has no slots: everyone gets the same text.</p>
            ) : (
              template.slots.map((slot, i) => (
                <div key={i} className="space-y-2 border border-border p-3">
                  <Field label={`Slot ${i + 1} — ${slotLabel(slot)}`} htmlFor={`${uid}-role-${i}`}>
                    <Select
                      id={`${uid}-role-${i}`}
                      selectSize="sm"
                      value={roles[i]}
                      onChange={(e) => setRole(i, e.target.value as SlotRole)}
                    >
                      {rolesFor(slot).map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {roles[i] === "text" ? (
                    <Field label={`Text for slot ${i + 1}`} htmlFor={`${uid}-text-${i}`}>
                      <Input
                        id={`${uid}-text-${i}`}
                        inputSize="sm"
                        value={texts[i] ?? ""}
                        onChange={(e) => setText(i, e.target.value)}
                      />
                    </Field>
                  ) : null}
                </div>
              ))
            )}
            {roles.includes("debt") ? (
              <p className="text-[13px] text-muted-foreground">A debt slot leaves out anyone who is not in debt when it sends.</p>
            ) : null}
            <div>
              <Caption>Sample</Caption>
              <Quote>{sample}</Quote>
              <p className="mt-1 text-[12px] text-muted-foreground">{plural(smsParts(sample), "SMS part")} each</p>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <SegmentedControl<AudienceKind>
              ariaLabel="Who gets it"
              size="sm"
              value={audience}
              onChange={(value) => {
                setError(null);
                setAudience(value);
              }}
              options={[
                { value: "student", label: "Students" },
                { value: "group", label: "A class" },
                { value: "debtors", label: "Debtors" },
              ]}
            />

            {audience === "student" ? (
              <div className="space-y-3">
                <Field
                  label="Find a student"
                  htmlFor={`${uid}-search`}
                  hint={`Name, username or lc-up name — ${STUDENT_SEARCH_MIN} letters or more. Up to ${CAMPAIGN_LIMIT}.`}
                >
                  <Input id={`${uid}-search`} inputSize="sm" value={search} onChange={(e) => setSearch(e.target.value)} />
                </Field>
                {hits.length > 0 ? (
                  <ul className="divide-y divide-border border border-border text-[13px]">
                    {hits.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-foreground">{s.name}</p>
                          <p className="truncate text-[12px] text-muted-foreground">
                            {[s.lcup_name, s.phone || "no phone", s.balance !== null ? money(s.balance) : ""]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Add ${s.name}`}
                          disabled={picked.length >= CAMPAIGN_LIMIT}
                          onClick={() => addStudent(s)}
                        >
                          Add
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : search.trim().length >= STUDENT_SEARCH_MIN && students.data && !students.isFetching ? (
                  <p className="text-[13px] text-muted-foreground">No linked student matches.</p>
                ) : null}
                <div>
                  <Caption>{`${picked.length} picked`}</Caption>
                  {picked.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">Nobody yet.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {picked.map((p) => (
                        <li
                          key={p.id}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[13px]"
                        >
                          {p.name}
                          <button
                            type="button"
                            aria-label={`Remove ${p.name}`}
                            onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}
                            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}

            {audience === "group" && classrooms.isError ? (
              <LoadError what="class list" onRetry={() => void classrooms.refetch()} />
            ) : audience === "group" ? (
              <Field label="Class" htmlFor={`${uid}-class`} hint="Its active students; the phone is always lc-up's.">
                <Select
                  id={`${uid}-class`}
                  selectSize="sm"
                  value={classroomId ? String(classroomId) : ""}
                  onChange={(e) => setClassroomId(Number(e.target.value) || null)}
                >
                  <option value="">Choose a class…</option>
                  {(classrooms.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {`${c.name} · ${plural(c.students, "student")}, ${c.with_phone} with a phone`}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {audience === "debtors" ? (
              <p className="text-[13px] text-muted-foreground">
                Every lc-up-linked learner who owes, frozen ones included — worked out when it sends.
              </p>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <SegmentedControl<"now" | "at">
              ariaLabel="When"
              size="sm"
              value={when}
              onChange={setWhen}
              options={[
                { value: "now", label: "Now" },
                { value: "at", label: "At a set time" },
              ]}
            />
            {when === "at" ? (
              <Field label="Goes out at" htmlFor={`${uid}-at`} hint="Your device's time.">
                <Input id={`${uid}-at`} type="datetime-local" inputSize="sm" value={at} onChange={(e) => setAt(e.target.value)} />
              </Field>
            ) : (
              <p className="text-[13px] text-muted-foreground">It goes out as soon as it is confirmed.</p>
            )}
          </>
        ) : null}

        {step === 4 && preview && previewed ? (
          <>
            {preview.over_limit ? (
              <Alert tone="danger">
                More than {preview.limit} recipients ({preview.count}) — narrow the audience.
              </Alert>
            ) : preview.count === 0 ? (
              <Alert tone="warning">Nobody would receive it — see who is left out below.</Alert>
            ) : null}
            <p className="text-[15px] font-semibold tabular-nums text-foreground">
              {plural(preview.count, "recipient")} · {plural(preview.parts_total, "SMS part")} · ~{money(preview.cost)}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {previewed.draft.scheduled_at
                ? `Goes out ${dateTime(previewed.draft.scheduled_at)}. `
                : "Goes out as soon as it is confirmed. "}
              The recipients are worked out again when it sends.
            </p>
            {preview.samples.length > 0 ? (
              <div className="space-y-2">
                <Caption>Samples</Caption>
                {preview.samples.map((s, i) => (
                  <div key={i} className="border border-border px-3 py-2 text-[13px]">
                    <p className="mb-1 text-[12px] text-muted-foreground">
                      {s.name} · {s.phone} · {plural(s.parts, "part")}
                    </p>
                    <p className="whitespace-pre-wrap">{s.text}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <div>
              <Caption>Left out</Caption>
              <SkippedList skipped={preview.skipped} />
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
