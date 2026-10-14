# lc-up phone confirmation for duplicate accounts — plan

**Goal:** a student with two or three same-name accounts types their phone number on the account
they use; that account becomes the one lc-up is linked to, and its groups and lc-up attendance
follow.

**Owner (2026-10-14, chat):**
- "hozir duplicate ism familiyali o'quvchilarga forma jo'nating ular qaysi accountidan kirib
  o'shandan o'zlarini nomerlarini yozsa shu account ularning main accounti bo'ladi qolgan
  o'quvchiga tegmay qo'yavering."
- Public students: the phone stays optional. Centre students: a new account is created
  automatically. Both are already true, so there is no code change.
- The design was approved with "ha, boshlang."

## Who is asked

Active `student` accounts whose first and last name, as a set of words (`phones.name_tokens`), are
shared with another active student account, where **exactly one** account in that group holds a
live lc-up link with a phone.

Prod 2026-10-14: 22 groups, 47 accounts (19 pairs, 3 triples). Groups with no linked account (8),
or with two, are left alone.

The `lcup_phone_prompts` command creates one `LcupPhonePrompt` per account, after `--apply`. It is
shown to the owner first, without `--apply`.

## Flow

1. While an account has a PENDING prompt, `missing_fields` lists `lcup_phone`, after `password`.
   The existing blocking `ProfileCompletionGate` asks for it. The copy is Uzbek, as the owner
   wrote it.
2. `POST /api/lcup/claim/phone/ {phone}`:
   - **Normalised equal to the link's lc-up phone:** in one transaction, `link.user` becomes this
     account (CONFIRMED, "confirmed by the student's phone"). This prompt becomes CONFIRMED and the
     other prompts of that lc-up student become SUPERSEDED, so the form disappears from the
     student's other accounts. On commit, `lcup.tasks.follow_student(link)` is queued.
   - **Different:** 400, with the lc-up number's last two digits as a hint, and `failed_attempts`
     +1. After 10 failures: 429 "ask the administrator".
3. `POST /api/lcup/claim/phone/ {not_me: true}` makes the prompt NOT_ME (a namesake). The form is
   gone and nothing moves.
4. `follow_student`:
   - It does not run beside the 15-min sync: it retries in 90 s while `lcup:sync-running` is held.
   - It runs the roster for each paired group the lc-up student is in. The new account is added;
     the old one leaves through `to_remove_unlinked`.
   - With the attendance pull on, it then runs `import_history(..., groups=those)` until
     yesterday. The new account gets lc-up's marks with their XP, and the old account's marks on
     recorded days go, quietly.
5. The other accounts are not closed; they just have no groups. The admin's own relink
   (`StudentLinkView`) also supersedes prompts and queues `follow_student`.

## Files

- `lcup/models.py` + migration `0005`: `LcupPhonePrompt(user 1:1, student FK, state, failed_attempts, created_at, resolved_at)`.
- `lcup/phone_confirm.py`: `duplicate_groups`, `create_prompts`, `phone_requirement`, `confirm_phone`, `dismiss_prompt`, `supersede_prompts`.
- `lcup/attendance.py`: `import_history(..., groups=None)`. Given groups, it reads lc-up per group (`group_id`).
- `lcup/tasks.py`: `follow_student`.
- `lcup/views.py`, `urls.py`: `ClaimPhoneView`; `StudentLinkView` follow-up.
- `lcup/apps.py`: register `phone_requirement`.
- `lcup/management/commands/lcup_phone_prompts.py`: report by default, `--apply` creates, `--status` counts.
- Frontend: `lcupApi.confirmPhone/notMe`; a `phone` step in `ProfileCompletionGate`.
- Tests: `lcup/tests_phone_confirm.py`; `ProfileCompletionGate.phone.test.tsx`.

## Rollout (each step needs the owner's yes)

1. Migrate first (lcup.0005), then a full blue-green release (the frontend changed).
2. Run `lcup_phone_prompts` (report) and show the owner the 22 groups.
3. Run `--apply`, then watch `--status`.
