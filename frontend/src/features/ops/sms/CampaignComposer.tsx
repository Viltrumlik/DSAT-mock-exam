"use client";

/**
 * A new campaign on one page: ① who, ② what, ③ when on the left, each folding into one line once
 * it is done; on the right the SMS as a phone shows it, what the send comes to, and Send.
 *
 * The figures are the server's. Every change asks again, PREVIEW_DEBOUNCE_MS after the last one,
 * and an answer counts only while it still matches what the cards say, so Send is off from the
 * moment anything changes until the server has priced exactly that. Before a template is chosen
 * only the audience can be asked about, which is what makes the count live in card ①.
 *
 * Recipients are worked out again when it sends, so a scheduled debtors campaign leaves out anyone
 * who has paid by then. A send that got no answer may have gone out (`mayHaveBeenSent`): Send stays
 * off after one, because a second click would be a second, paid campaign.
 */

import Link from "next/link";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { useRouter, useSearchParams } from "next/navigation";

import { useToast } from "@/components/ToastProvider";
import { Alert, Button } from "./consoleKit";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { AudienceStep, audienceBody } from "./composer/AudienceStep";
import { MessageStep, rolesFor } from "./composer/MessageStep";
import { PhonePreview } from "./composer/PhonePreview";
import { RecipientsDrawer } from "./composer/RecipientsDrawer";
import { SummaryCard, figuresLine, type Figures } from "./composer/SummaryCard";
import { useComposerDraft, type AudienceValue, type ComposerDraft } from "./composer/useComposerDraft";
import { WhenStep, whenIso, whenLabel, whenProblem, type WhenValue } from "./composer/WhenStep";
import { fillPattern, firstLine, isAscii, money, plural, sampleValues, smsParts, tashkentDateTime } from "./format";
import { BOX, LoadError, Loading, MAYBE_SENT, TEXT_BUTTON, errorText, mayHaveBeenSent, paidErrorText } from "./panelKit";
import type {
  AudienceBody,
  AudienceClassroom,
  AudienceKind,
  AudienceOptions,
  AudiencePreview,
  CampaignDraft,
  CampaignPreview,
} from "./smsApi";
import {
  useAudienceClassrooms,
  useAudienceOptions,
  useCreateCampaign,
  usePreviewAudience,
  usePreviewCampaign,
  useSmsOverview,
  useSmsTemplates,
} from "./smsHooks";
import { campaignHref, smsTabHref } from "./smsTabs";

const PREVIEW_DEBOUNCE_MS = 400;

const KINDS: AudienceKind[] = ["student", "group", "filter", "debtors"];

type Question = { kind: "draft"; body: CampaignDraft } | { kind: "audience"; body: AudienceBody };
type Reply = CampaignPreview | AudiencePreview;
type Answer = { key: string; reply?: Reply; error?: string };
type CardKey = "who" | "message" | "when";

/** The server's answer for the question as it now stands; an answer to an older one never counts. */
function useLivePreview(question: Question | null) {
  const { mutate: previewDraft } = usePreviewCampaign();
  const { mutate: previewAudience } = usePreviewAudience();
  const key = question ? JSON.stringify(question) : null;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [lastReply, setLastReply] = useState<Reply | null>(null);
  const [asked, setAsked] = useState(0);
  const latestKey = useRef(key);
  useEffect(() => {
    latestKey.current = key;
  });

  useEffect(() => {
    if (!key) return;
    const q = JSON.parse(key) as Question;
    const timer = setTimeout(() => {
      // Two hooks ask, so an audience answer can land after the draft's: an old answer changes nothing.
      const done = {
        onSuccess: (reply: Reply) => {
          if (latestKey.current !== key) return;
          setAnswer({ key, reply });
          setLastReply(reply);
        },
        onError: (e: unknown) => {
          if (latestKey.current !== key) return;
          setAnswer({ key, error: errorText(e, "Couldn't work it out. Try again.") });
        },
      };
      if (q.kind === "draft") previewDraft(q.body, done);
      else previewAudience(q.body, done);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, asked, previewDraft, previewAudience]);

  const current = answer?.key === key ? answer : null;
  return {
    key,
    checking: Boolean(key) && !current,
    reply: current?.reply ?? null,
    error: current?.error ?? null,
    /** The newest answer, even if the cards have moved on: figures to show dimmed, never to act on. */
    last: lastReply,
    retry: () => {
      setAnswer(null);
      setAsked(asked + 1);
    },
  };
}

function figuresOf(reply: Reply): Figures {
  const figures: Figures = { count: reply.count, noPhone: reply.skipped.no_phone?.length ?? 0 };
  return "cost" in reply ? { ...figures, parts: reply.parts_total, cost: reply.cost } : figures;
}

/** "Debtors", a class's name, "3 groups", "Math, Junior" or a student's name; "" for several students. */
function whoWords(
  who: AudienceValue,
  classrooms: AudienceClassroom[] | undefined,
  options: AudienceOptions | undefined,
  names: Record<number, string>,
): string {
  if (who.audience === "debtors") return "Debtors";
  if (who.audience === "student") return who.ids.length === 1 ? names[who.ids[0]] ?? "" : "";
  if (who.audience === "group") {
    if (who.ids.length !== 1) return plural(who.ids.length, "group");
    return classrooms?.find((c) => c.id === who.ids[0])?.name ?? "";
  }
  const labelOf = <V,>(values: V[], rows: { value: V; label: string }[] | undefined) =>
    values.map((v) => rows?.find((r) => r.value === v)?.label).filter(Boolean);
  return [
    ...labelOf(who.filter.subjects, options?.subjects),
    ...labelOf(who.filter.levels, options?.levels),
    ...labelOf(who.filter.branches, options?.branches),
    ...labelOf(who.filter.days, options?.days),
  ].join(", ");
}

function Card({
  mark,
  title,
  summary,
  open,
  onOpen,
  children,
}: {
  mark: string;
  title: string;
  summary: string;
  open: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <section className={BOX}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onOpen}
        className="flex w-full items-baseline gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ms-ring"
      >
        <span className="shrink-0 text-[13px] font-semibold text-ms-fg">
          {mark} {title}
        </span>
        {open ? null : <span className="min-w-0 truncate text-[13px] text-ms-fg-3">{summary}</span>}
      </button>
      {open ? <div className="sms-rise space-y-3 border-t border-ms-border p-3">{children}</div> : null}
    </section>
  );
}

const BACK = (
  <Link
    href={smsTabHref("campaigns")}
    className="inline-flex items-center gap-1 text-[13px] font-medium text-ms-fg-3 hover:text-ms-fg"
  >
    <Icon name="left" size="sm" className="size-4" />
    Campaigns
  </Link>
);

function ComposerForm({ start }: { start: ComposerDraft }) {
  const router = useRouter();
  const { push } = useToast();
  const templates = useSmsTemplates();
  const classrooms = useAudienceClassrooms();
  const options = useAudienceOptions();
  const overview = useSmsOverview();
  const creator = useCreateCampaign();

  const [who, setWho] = useState(start.who);
  const [message, setMessage] = useState(start.message);
  const [when, setWhen] = useState<WhenValue>({ mode: "now", at: "" });
  const [open, setOpen] = useState<CardKey>(!audienceBody(start.who) ? "who" : !start.message.templateId ? "message" : "when");
  const [listOpen, setListOpen] = useState(false);
  const [refused, setRefused] = useState<{ key: string | null; text: string } | null>(null);
  const [maybeSent, setMaybeSent] = useState(false);
  const [created, setCreated] = useState(false);

  const template = (templates.data?.templates ?? []).find((t) => t.usable && t.eskiz_id === message.templateId) ?? null;
  const body = audienceBody(who);
  const messageDone = Boolean(template) && message.roles.every((r, i) => r !== "text" || (message.texts[i] ?? "").trim());
  const draft: CampaignDraft | null =
    body && template && messageDone && !whenProblem(when)
      ? {
          template_id: template.eskiz_id,
          slot_roles: message.roles,
          slot_texts: message.roles.map((r, i) => (r === "text" ? (message.texts[i] ?? "").trim() : "")),
          ...body,
          scheduled_at: whenIso(when),
        }
      : null;

  const live = useLivePreview(draft ? { kind: "draft", body: draft } : body ? { kind: "audience", body } : null);

  const shown = body ? live.last : null;
  const names: Record<number, string> = {};
  for (const person of Object.values(shown?.skipped ?? {}).flat()) if (person) names[person.user_id] = person.name;
  for (const person of shown?.recipients ?? []) names[person.user_id] = person.name;

  const whoSummary = body
    ? [shown ? plural(shown.count, "student") : "", whoWords(who, classrooms.data, options.data, names)].filter(Boolean).join(" · ")
    : "Choose who gets it";
  const messageSummary = template ? `${template.label} · ${firstLine(template.original || template.pattern, 60)}` : "Choose a template";

  const reply = live.reply;
  const priced = reply && "cost" in reply ? reply : null;
  const sample = priced?.samples[0];
  const text = sample?.text ?? (template ? fillPattern(template.pattern, sampleValues(message.roles, message.texts)) : "");
  const canSend =
    Boolean(draft && priced && !priced.over_limit && priced.count > 0) && !live.checking && !creator.isPending && !maybeSent && !created;
  const figures = shown ? figuresOf(reply ?? shown) : null;

  const send = () => {
    if (!draft || !priced || !canSend) return;
    const moment = draft.scheduled_at ? `at ${tashkentDateTime(draft.scheduled_at)}` : "now";
    if (!window.confirm(`Send ${priced.count} SMS, ~${money(priced.cost)}, ${moment}?`)) return;
    setRefused(null);
    creator.mutate(draft, {
      onSuccess: (campaign) => {
        setCreated(true); // it stays on screen until the route changes, and it is paid for now
        push({
          tone: "success",
          message: draft.scheduled_at
            ? `Campaign #${campaign.id} is scheduled for ${tashkentDateTime(campaign.scheduled_at ?? draft.scheduled_at)}.`
            : `Campaign #${campaign.id} is sending now.`,
        });
        router.push(campaignHref(campaign.id));
      },
      onError: (e) => {
        if (mayHaveBeenSent(e)) setMaybeSent(true);
        else setRefused({ key: live.key, text: paidErrorText(e, "Couldn't create the campaign. Try again.") });
      },
    });
  };

  const sendButton = (
    <Button size="sm" fullWidth disabled={!canSend} loading={creator.isPending} onClick={send}>
      <Icon name="send" size="sm" className="size-4" />
      {priced ? `Send ${priced.count} SMS` : "Send"}
    </Button>
  );

  return (
    <div className="space-y-4">
      {BACK}
      <OpsPageHeader section="SMS" title="New campaign" description="Who, what and when, then the SMS as it will look." />
      {maybeSent ? <Alert tone="danger">{MAYBE_SENT}</Alert> : null}
      {refused && refused.key === live.key ? <Alert tone="danger">{refused.text}</Alert> : null}

      {/* minmax(0,1fr) on a phone too: an auto column grows to a nowrap line and pushes the page sideways. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,1fr)_300px] md:items-start">
        <div className="min-w-0 space-y-3">
          <Card mark="①" title="Who" summary={whoSummary} open={open === "who"} onOpen={() => setOpen("who")}>
            <AudienceStep value={who} onChange={setWho} allowed={KINDS} names={names} />
            {body && shown ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[13px] font-medium tabular-nums text-ms-fg">
                  {figuresLine({ count: shown.count, noPhone: shown.skipped.no_phone?.length ?? 0 })}
                </p>
                <button type="button" className={TEXT_BUTTON} onClick={() => setListOpen(true)}>
                  See the list
                </button>
              </div>
            ) : null}
            <Button size="sm" variant="secondary" disabled={!body} onClick={() => setOpen("message")}>
              Continue
            </Button>
          </Card>

          <Card mark="②" title="Message" summary={messageSummary} open={open === "message"} onOpen={() => setOpen("message")}>
            <MessageStep {...message} roleChoices={rolesFor} onChange={setMessage} />
            <Button size="sm" variant="secondary" disabled={!messageDone} onClick={() => setOpen("when")}>
              Continue
            </Button>
          </Card>

          <Card mark="③" title="When" summary={whenLabel(when)} open={open === "when"} onOpen={() => setOpen("when")}>
            <WhenStep value={when} onChange={setWhen} />
          </Card>
        </div>

        <div className="space-y-3 md:sticky md:top-4">
          <PhonePreview text={text} parts={sample?.parts ?? smsParts(text)} ascii={isAscii(text)} />
          <SummaryCard
            figures={figures}
            checking={live.checking}
            error={live.error}
            onRetry={live.retry}
            balance={overview.data?.balance}
            overLimit={Boolean(reply?.over_limit)}
            limit={shown?.limit ?? 300}
            skipped={shown?.skipped}
          >
            <div className="hidden md:block">{sendButton}</div>
          </SummaryCard>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-ms-border bg-ms-card p-2 md:hidden">
        <p className="min-w-0 flex-1 text-[12px] font-medium tabular-nums text-ms-fg">{figures ? figuresLine(figures) : ""}</p>
        <div className="shrink-0">{sendButton}</div>
      </div>

      {listOpen && shown ? (
        <RecipientsDrawer
          open
          onClose={() => setListOpen(false)}
          recipients={shown.recipients ?? []}
          taken={shown.skipped.excluded ?? []}
          excluded={who.excluded}
          onChange={(excluded) => setWho({ ...who, excluded })}
        />
      ) : null}
    </div>
  );
}

function Composer() {
  const search = useSearchParams();
  const start = useComposerDraft(search);
  if (start.isPending) return <Loading />;
  if (start.isError || !start.draft) {
    return (
      <div className="space-y-3">
        {BACK}
        <LoadError what="campaign to repeat" onRetry={() => void start.refetch()} />
      </div>
    );
  }
  return <ComposerForm start={start.draft} />;
}

export function CampaignComposer() {
  // useSearchParams needs a Suspense boundary above it, or the production build's prerender fails.
  return (
    <Suspense fallback={null}>
      <Composer />
    </Suspense>
  );
}
