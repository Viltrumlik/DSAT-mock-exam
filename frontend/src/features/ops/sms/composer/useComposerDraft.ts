"use client";

import type { AudienceFilter, AudienceKind, Campaign, SlotRole } from "../smsApi";
import { useSmsCampaign } from "../smsHooks";

/** Who a campaign (and, in time, an automation) goes to, as the composer holds it. */
export interface AudienceValue {
  audience: AudienceKind;
  /** student: user ids; group: classroom ids; debtors, filter: []. */
  ids: number[];
  filter: AudienceFilter;
  /** People taken out by hand. */
  excluded: number[];
  minDebt?: number;
}

export interface MessageValue {
  templateId: number | null;
  roles: SlotRole[];
  texts: string[];
}

export interface ComposerDraft {
  who: AudienceValue;
  message: MessageValue;
}

export const EMPTY_FILTER: AudienceFilter = { subjects: [], levels: [], branches: [], days: [] };

const wholeId = (raw: string | null) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : 0;
};

function fromCampaign(c: Campaign): ComposerDraft {
  return {
    who: {
      audience: c.audience,
      ids: c.audience_ids,
      filter: { ...EMPTY_FILTER, ...c.audience_filter },
      excluded: c.excluded_user_ids,
    },
    message: { templateId: c.template_eskiz_id, roles: c.slot_roles, texts: c.slot_texts },
  };
}

/**
 * What the composer opens with: `?from=<campaign>` is Repeat, the campaign's template, slots and
 * audience; `?student=<id>` is that one student; `?classroom=<id>` is that one class (the class page's
 * "Message class"); `?audience=debtors` is every learner who owes (Finance › Debtors' "Remind all");
 * otherwise nothing yet.
 */
export function useComposerDraft(search: URLSearchParams) {
  const from = wholeId(search.get("from"));
  const student = wholeId(search.get("student"));
  const classroom = wholeId(search.get("classroom"));
  const debtors = !student && !classroom && search.get("audience") === "debtors";
  const source = useSmsCampaign(from, false);
  if (from) {
    return {
      isPending: source.isPending,
      // Only with nothing to go on. A later refresh failing (the panel is invalidated when a send
      // gets no answer) must not take down the form, and with it what the form knows about that send.
      isError: source.isError && !source.data,
      refetch: source.refetch,
      draft: source.data ? fromCampaign(source.data.campaign) : null,
    };
  }
  const draft: ComposerDraft = {
    who: {
      audience: student ? "student" : debtors ? "debtors" : "group",
      ids: student ? [student] : classroom ? [classroom] : [],
      filter: EMPTY_FILTER,
      excluded: [],
    },
    message: { templateId: null, roles: [], texts: [] },
  };
  return { isPending: false, isError: false, refetch: source.refetch, draft };
}
