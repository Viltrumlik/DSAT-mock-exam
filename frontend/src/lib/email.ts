/**
 * `User.email` is nullable.
 *
 * `null` means the person has not supplied an address — a Telegram signup arrives
 * without one — or lost it to someone who proved control of the mailbox. Those accounts
 * sign in with their username instead.
 *
 * Earlier revisions invented placeholder addresses (`tg{id}@telegram.mastersat.local`,
 * `released-…@…invalid`) purely because the column could not be empty, which forced
 * every display site to learn how to decode them. Mirrors
 * `backend/users/email_utils.py`.
 */

/** The address to show a human, or `""` when there is none. */
export function displayEmail(address: string | null | undefined): string {
  return (address ?? "").trim();
}
