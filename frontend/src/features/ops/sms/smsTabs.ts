import { tabHref } from "@/features/ops/detail/tabs";
import { P } from "@/features/ops/permissions";

/**
 * The SMS page's tabs and their addresses, apart from the page so a panel can link to another
 * tab without importing the page (and every panel with it).
 */

export type SmsTab = "overview" | "journal" | "campaigns" | "debt" | "templates";

export const SMS_TAB_IDS: readonly SmsTab[] = ["overview", "journal", "campaigns", "debt", "templates"];

/** The tabs' names — on the page and in the console panel's tree under SMS (Shell v0.4). */
export const SMS_TAB_LABEL: Record<SmsTab, string> = {
  overview: "Overview",
  journal: "Journal",
  campaigns: "Campaigns",
  debt: "Debt warnings",
  templates: "Templates",
};

/**
 * What each tab needs: the overview and journal open to anyone who sends; the debt warnings are `send_debt_sms`'s.
 * The page shows only the tabs a person may open; so does the panel's tree.
 */
export const SMS_TAB_NEEDS: Record<SmsTab, readonly string[]> = {
  overview: [P.sendSms, P.sendDebtSms],
  journal: [P.sendSms, P.sendDebtSms],
  campaigns: [P.sendSms],
  debt: [P.sendDebtSms],
  templates: [P.sendSms],
};

export const SMS_PATH = "/ops/sms";

/** The address of one tab. Nothing else is carried over: the journal's filters belong to the journal. */
export function smsTabHref(key: SmsTab): string {
  return tabHref(SMS_PATH, new URLSearchParams(), key, "overview");
}

export const campaignHref = (id: number) => `${SMS_PATH}/campaigns/${id}`;

export const NEW_CAMPAIGN_PATH = `${SMS_PATH}/campaigns/new`;
