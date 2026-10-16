# Class Telegram groups

The class group used to be a static invite link in the classroom header — a URL anybody
could forward, which is how the groups filled with siblings, friends and ex-students that
nothing on the site could account for.

A join is now a **ticket**. The site mints one single-use invite per student per class,
records the account it was cut for, and when Telegram reports the join it checks that the
account which walked through the door is that one.

## What a student sees

1. **Join Telegram group** in the classroom header opens a dialog listing the rules. The
   rules come from the server (`classes.telegram_group.JOIN_RULES`), so the page and the bot
   cannot drift apart.
2. If the bot has never met them, the dialog's one button is **Open the bot** — a
   `https://t.me/<bot>?start=<token>` deep link cut for their account and good for an hour
   (`TelegramStartToken`). They press Start in Telegram, and that single update carries the
   token *and* their Bot API user id: the introduction, made by the person themselves. The
   bot binds the two, then mints and sends their invite in the same chat.
3. Once bound, **Get my invite link** on the page mints a link that admits one person and
   expires in 30 minutes (`CLASSROOM_TELEGRAM_INVITE_TTL_MINUTES`). It is shown on screen
   and DM'd, which now works — a bot may only message somebody who has messaged it first,
   and pressing Start is that message.
4. Opening the link puts them in the group. If somebody else opens it, that person is removed
   and the ticket is spent — the student comes back for a new one.

## Two Telegram ids, and only one of them is the bot's

This is the trap, and it cost a production evening. A `User` carries **two** Telegram
numbers and they are not interchangeable:

| Column | Where it comes from | Shape |
|---|---|---|
| `telegram_id` | the subject of an `oauth.telegram.org` **sign-in** | 17-19 digits |
| `telegram_bot_user_id` | the `from.id` of a **Bot API** update | 9-11 digits |

They are different numbers for the same human. The first version of this feature checked
arrivals against `telegram_id`, so every genuine join was rejected as an identity mismatch
and every DM went to an id that does not exist. Read the bot one through
`telegram_group.bot_id_for(user)` and never off the model, so the next person to touch this
has to notice which one they are asking for.

Signing in with Telegram does **not** connect a student to the bot. Only pressing Start on
their own `/start` link does.

## What happens without anybody clicking

| Event | Telegram group | The class on the site |
|---|---|---|
| Account frozen | student removed, outstanding link revoked | **unchanged** — they stay in the class |
| Account unfrozen | nothing automatic | unchanged |
| Removed from the class | student removed | (that *is* the change) |
| Someone else uses a link | that person removed, ticket burned | unchanged |
| A stranger joins some other way | recorded and reported, **not** removed | — |
| Account deleted | stays in the group; the record survives as an unrecognised member | (the account is gone) |
| **Anything at all, to somebody who was in the group before the bot** | nothing | as above |

Unfreezing deliberately does not re-invite anybody. The student presses the button again.

Deleting an account is the one case that needs a person. The bot will not remove somebody it
can no longer identify (rule 1 below), so the row is kept with its Telegram handle and shows
in the staff roster as unrecognised — remove them from the group by hand. Freeze rather than
delete if you want the group to look after itself.

## The three safety rules

The automation is allowed to run unattended because it will not act outside these:

1. **It never removes a Telegram account it cannot match to a student here.** A teacher's
   second account, a parent, the owner of the centre — recorded, reported, left alone. The
   single exception is somebody who walked in on a ticket cut for a different person.
2. **It never removes a chat administrator**, whatever the site believes.
3. **It never removes somebody it did not watch arrive.** See below — this is the rule that
   makes switching an existing group over a safe thing to do.

## Switching on a group that already has people in it

Every class group already has people in it, and none of them are the bot's to remove. It was
not there when they came in, and the Bot API cannot list them, so it does not know they are
there at all.

**Watching starts at the first join the bot sees.** From that moment every arrival is
checked, recorded and managed. Everyone from before is left exactly where they are — for
good, until they do something about it themselves:

> A student from before who **leaves the group and comes back** has arrived on the watch.
> From that moment they are managed like anybody else.

Pressing **Join Telegram group** on the site does *not* count. The site probes Telegram,
sees they are already inside, tells them so and mints nothing — but "they are inside" is not
"we saw them come in", and only the second one lets the bot act.

What this costs, and it is worth being plain about it: **freezing a student who has been in
the group since before the bot does not take them out of it.** Nothing here will. The
roster (`GET /api/classes/<id>/telegram/members/`) flags every such person with
`"watched": false`, and the Django admin has an *observed arrival* filter for the same
question — remove them by hand if the school wants them out. Over a term the group empties
of these people on its own, one departure at a time.

## Setting a class up

1. Add the bot to the class's Telegram group and **make it an administrator** with *Invite
   users via link* and *Ban users*. Without the first, nobody can ever join; without the
   second everybody joins and nobody can be taken out — which is the worse failure, because
   it looks like it is working.
2. Send `/chatid` in the group. The bot replies with the numeric id.
3. Paste that into **Telegram chat id** on the class in the ops console
   (`/ops/classrooms` → edit). Setting it is what switches the class from a plain link to a
   managed group; clearing it switches back.

Check it worked: `GET /api/classes/<id>/telegram/members/` (teaching team only) reports the
group's health and who the site thinks is in it, or:

```
python manage.py audit_classroom_telegram_groups --health
```

## Server configuration

| Variable | Default | What it is |
|---|---|---|
| `CLASSROOM_TELEGRAM_BOT_TOKEN` | falls back to `TELEGRAM_BOT_TOKEN` | The bot that administers the groups. The fallback is the point: it is the same bot students already link their account through. Set this only if that bot's single webhook slot is spoken for. |
| `CLASSROOM_TELEGRAM_WEBHOOK_SECRET` | *(none — required)* | Echoed by Telegram in `X-Telegram-Bot-Api-Secret-Token`. The webhook **fails closed** without it. |
| `CLASSROOM_TELEGRAM_INVITE_TTL_MINUTES` | `30` | How long a minted link stays usable. |
| `CLASSROOM_TELEGRAM_AUDIT_BATCH` | `60` | Classrooms per sweep. |
| `CLASSROOM_TELEGRAM_JOIN_THROTTLE` | `10/hour` | Invites one student may mint. |

Then register the webhook — **on the apex host, not a console subdomain**:

```
python manage.py set_classroom_bot_webhook --base-url https://mastersat.uz
python manage.py set_classroom_bot_webhook --show     # verify
```

`chat_member` is the update this feature runs on and Telegram **does not send it by
default**. The command names it in `allowed_updates` explicitly; a webhook registered any
other way will look configured, mint links happily, and never learn that anybody joined.

## The sweep

`classes.tasks.audit_classroom_telegram_groups` runs every 30 minutes (Celery Beat) and
reconciles each group with the site: it re-checks the bot's own rights, removes anybody who
should no longer be there, marks the people who have quietly left, and clears expired
tickets. If the bot has been demoted it records the problem and touches nobody — a group it
cannot read is not a group to make decisions about.

**The Bot API cannot list a group's members** (only its administrators and a head count), so
the site can never enumerate a group from cold. It knows the people it has watched arrive,
which is why every arrival is written down including the ones matching nobody here.

## Where to look when something is wrong

* `classroom_telegram_events` — append-only: every link issued, join, rejection, removal and
  configuration problem, with the reason. This is the table that answers "why am I out of the
  group?".
* `classroom_telegram_members` — current state per person per class.
* Both are read-only in the Django admin under **Classes**.

## The bot's own sign-in (plan 2026-10-16)

The 2026-09 flow above hands a student a one-time link from the site. This adds a second door
that lives in the bot: the student signs in there with their MasterSAT login and password, and
the bot shows their class groups as buttons. It exists for two reasons — students who never
opened the bot cannot be messaged (freeze, unfreeze and payment notes all need a chat), and the
members who were in a group before the bot cannot be managed until somebody identifies them.
All bot text is Uzbek (Latin) and lives in `classes/telegram_texts.py`; the site stays English.

Switched by `CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED` (default **off**). Off keeps the old `/start`
reply, the old join dialog and the old `?start=<token>` bind exactly as they were. On:

### Signing in

- The class page's Telegram button opens `t.me/<bot>?start=login` (`bot_url` in the join-state
  payload; empty while the flag is off, or for a class that is not managed). For a managed class
  with the flag off the button still opens the join dialog, and for a class nobody has set up it
  is still the static link.
- Every private chat with the bot then goes to the sign-in (`classes/telegram_bot.py`), and the
  `?start=<token>` bind is no longer consulted. The bot asks for the login (username, email or
  phone), then the password. **The password message is deleted the moment it arrives**, before
  anything else runs; if Telegram refuses the delete the student is told to remove it
  themselves. The password is never logged, stored, or written to the audit trail — the webhook
  log carries an outcome tag (`ask_password`, `wrong`, `locked`, `logged_in`…), never the text.
- Success connects that Telegram account to the student: `User.telegram_bot_user_id`, the
  **Bot API** id from the table above, not the OAuth one. Only learner roles qualify; a
  Telegram account already connected to a different MasterSAT account must send `/chiqish`
  first; an account with no usable password is told to set one on the site first. The lc-up
  "last 4 digits" first-time code is **not** accepted here — only a real password, through
  `EmailOrUsernameModelBackend`.
- `/chiqish` disconnects (clears `telegram_bot_user_id`). Sign-in, wrong tries, lock-outs and
  sign-out each leave a `SecurityAuditEvent` (`telegram_bot_login`, `_login_failed`,
  `_login_locked`, `telegram_bot_logout`).
- **Lock-out: 5 wrong tries, 15 minutes**, counted two ways at once and either one locks:
  per Telegram account (whatever it types), and per **MasterSAT account** — a username, an email
  and a phone spelling of one account all count against the same account, so trying several
  spellings or several Telegram accounts does not multiply the five. A login that names nobody is
  counted under its own spelling, so guessing at unknown logins is bounded too. This lock is the
  bot's only; the website's own login is unaffected. A half-typed sign-in expires after 10
  minutes. State and counters live in the cache (Redis in production); losing them in a restart
  costs a student one `/start`.
- **At the password step only an exact command escapes** (`/start`, `/guruhlar`, `/chiqish`, or
  one addressed to this bot as `/start@TheBot`). Anything else — including `/x` or `/start@2024`
  — is a password, and is deleted and checked. A password may begin with a slash.
- The webhook handles each Telegram `update_id` once (24 h), so a re-sent update cannot count
  one wrong password as two.

### The groups menu

- `/guruhlar` (and `/start` once connected) shows one button per active class the student sits in
  that has a Telegram group: **✅** inside, **➕** not yet, **🔒** frozen. Pressing ➕ replies, in
  the chat, with a one-time invite (single use, `CLASSROOM_TELEGRAM_INVITE_TTL_MINUTES`); a student
  already inside is told so; a frozen one gets a message saying why (debt vs admin wording) and no
  link. The button does not also DM the 2026-09 English courtesy copy.
- Opening the menu asks Telegram where the student is (`identify_memberships`, one
  `getChatMember` per group). Each group answers **in**, **out**, or **unknown** — unknown means
  Telegram could not be asked (a timeout, a 403, a wrong chat id). Unknown says nothing about
  whether they are inside, so nothing is written for it, and the menu shows ➕ for it (pressing
  it probes again).
- A member from before the bot who is found **in** becomes `identified_at` on their
  `classroom_telegram_members` row, and is **managed from then on** — rule 3 above now reads
  "the bot watched them arrive *or* they signed in and were found inside". The exception is a
  student who is frozen at that moment: they are not identified, and a `RECONCILED` event
  ("in the group while frozen; left for an admin to remove") is written so the admin can see
  them, and they stay the admin's to remove by hand.

### Messages the bot sends unprompted

- **A freeze** sends one message naming every group the student was actually taken out of (not
  one per group). Wording depends on why: lc-up debt (`FROZEN_LCUP_DEBT`) says the monthly
  payment was not made and that they can rejoin through the bot after paying; any other freeze
  says the account was frozen and to contact an administrator. Groups the bot left alone
  (rule 1/2/3) are not listed. Leaving the class, a mismatched ticket and an admin's removal
  have their own short wording.
- **A lifted freeze** sends "🔓" plus the menu, one ➕ per group. Nobody is re-invited
  automatically — unfreezing still waits for the student to press a button.
- **A payment** (below).

### Payments

`CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM` (ISO date-time, empty = off). A real lc-up sync queues
`send_telegram_payment_messages` (a dry run queues nothing); it runs as the `payment_messages`
stage, after the students' balances are refreshed and before the debt freeze, so "payment
received" reaches a student before "your groups are open again". It announces only
`kind="payment"` rows that lc-up created **after** that moment **and** that were paid in the last
7 days, once each (`LcupPayment.bot_notified_at`). A refund is never announced. The text names
the payment's own lc-up group and the amount ("500 000 so'm"), then either "no debt left" or
"debt left: X so'm". The debt is lc-up's **overall** balance — lc-up keeps no balance per group
(measured 2026-10-16), so the message does not pretend to one.

- Each payment is **claimed first** (`bot_notified_at` set only if still empty) and only the run
  that changes the row sends it, so two overlapping runs cannot both send.
- A failure that may pass — no answer from Telegram, 429, 5xx — gives the claim back and is
  retried by the next sync. One Telegram refused (the student blocked the bot, a bad chat: 403/400)
  stays marked and is counted as `refused`.
- A student with no bot connection is marked done and skipped; connecting later does not replay
  old payments.

### Ops: the class's Telegram part, and Remove

/ops → class → **Telegram** (`GET /api/classes/admin/classrooms/<id>/telegram/`) shows the bot's
health in the group, the head count Telegram reports (it cannot list members, so this differs
from "known here" until everybody has signed in), who the site knows is inside, which of them the
bot looks after (`managed`), and who is frozen. **Remove** (`POST …/telegram/remove/ {member_id}`,
admins only) is the admin deciding about exactly the people the bot will not touch: members from
before it who have not signed in, accounts it cannot place, frozen old debtors. It is a *forced*
removal — rules 1 and 3 are set aside, **rule 2 never is** (a chat administrator is never removed).
Because rule 2 needs the person's status, **a forced removal refuses when Telegram cannot report
it** (the person is left in place, the ticket is burned, a `CONFIG_ERROR` event is written, and
the endpoint answers 409 — press it again once Telegram answers). It also answers 409 when they
had already left or are an admin of the group.

### Asking the existing groups to sign in

`python manage.py announce_classroom_bot` lists every active class group (dry run);
`--send` posts the one note — with a button that opens the bot — into each, once per distinct
chat id. Run `--send` only with the owner's go-ahead: it speaks in every class group at once.
If any post fails the command **exits non-zero** and names the groups that did not get it;
retry exactly those with `--only CHAT_ID` (repeatable) so the others are not asked twice. An id
that matches no class group is refused before anything is posted — a mistyped id must not look
like a finished retry.

### Configuration and migrations

| Variable | Default | What it is |
|---|---|---|
| `CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED` | `False` | The bot's sign-in, groups menu, unfreeze note and the class page's bot button. |
| `CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM` | *(empty = off)* | ISO date-time; only lc-up payments created after it are announced. |

Two additive, nullable migrations (no index): `classes.0056` adds
`ClassroomTelegramMember.identified_at`; `lcup.0007` adds `LcupPayment.bot_notified_at`.
`set_classroom_bot_webhook` now also allows `callback_query` (a press on a menu button) —
re-run it after deploying, because Telegram sends nothing it was not asked for.

### Switch-on order

The order matters: the sign-in, the menu buttons and the unfreeze note only run once the flag is
on **and** a bot token is configured (`bot_login_enabled()` is both), and the class page only
shows the bot button for a class that already has its chat id. So the test group and the flag come
before the end-to-end test, and the payment flag comes last.

1. **Deploy**, zero-downtime, with a backup first. The two migrations (`classes.0056`,
   `lcup.0007`) are additive and nullable, so migrating first is safe.
2. `python manage.py set_classroom_bot_webhook --base-url https://mastersat.uz`, then
   `python manage.py set_classroom_bot_webhook --show` — `callback_query` must be in the list.
3. **One test group first.** Make the bot an administrator there (Invite users + Ban users), send
   `/chatid` in the group, and paste the id into that class in /ops.
4. Set `CLASSROOM_TELEGRAM_BOT_LOGIN_ENABLED=True` and restart. Keep a bot token configured
   (`CLASSROOM_TELEGRAM_BOT_TOKEN`, or the `TELEGRAM_BOT_TOKEN` it falls back to): without it the
   flag does nothing.
5. **Test end to end in that group** with one test student in that class: sign in, ➕, join,
   freeze (the removal message names the group), unfreeze (the menu comes back with ➕).
6. **The remaining groups:** for each one, the bot as an administrator, `/chatid`, and the id
   pasted into /ops.
7. With the owner's go-ahead, `python manage.py announce_classroom_bot` (dry run), then
   `announce_classroom_bot --send`. If any group fails, retry only those with
   `--only CHAT_ID` (repeatable).
8. Set `CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM` to the switch-on moment (ISO date-time), so only
   payments lc-up creates after it are announced.
