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
