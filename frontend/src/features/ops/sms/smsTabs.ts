import { tabHref } from "@/features/ops/detail/tabs";

/**
 * The SMS page's tabs and their addresses, apart from the page so a panel can link to another
 * tab without importing the page (and every panel with it).
 */

export type SmsTab = "overview" | "journal" | "campaigns" | "debt" | "templates";

export const SMS_PATH = "/ops/sms";

/** The address of one tab. Nothing else is carried over: the journal's filters belong to the journal. */
export function smsTabHref(key: SmsTab): string {
  return tabHref(SMS_PATH, new URLSearchParams(), key, "overview");
}

export const campaignHref = (id: number) => `${SMS_PATH}/campaigns/${id}`;
