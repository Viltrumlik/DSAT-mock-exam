/**
 * Placeholder addresses the backend stores on `User.email`.
 *
 * `email` is the login key and cannot be empty, so accounts without a real address
 * carry a stand-in: Telegram signups get `tg{id}@telegram.mastersat.local`, and an
 * account whose address was claimed by someone who proved control of it gets a
 * `released-…@released.mastersat.invalid`. Neither should ever be shown to the person
 * as if it were their contact address.
 *
 * Mirrors `backend/users/email_utils.py`. Keep the two lists in step.
 */
const PLACEHOLDER_DOMAINS = ["@telegram.mastersat.local", "@released.mastersat.invalid"];

export function isPlaceholderEmail(address: string | null | undefined): boolean {
  const addr = (address ?? "").trim().toLowerCase();
  if (!addr) return true;
  return PLACEHOLDER_DOMAINS.some((d) => addr.endsWith(d));
}

/** The address to show a human, or `""` when there is nothing worth showing. */
export function displayEmail(address: string | null | undefined): string {
  return isPlaceholderEmail(address) ? "" : (address ?? "").trim();
}
