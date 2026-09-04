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
2. If their Telegram is not connected yet, step one is the existing account link
   (`/api/users/telegram/start/`, the same flow as the profile page). They land back on the
   classroom.
3. **Get my invite link** mints a link that admits one person and expires in 30 minutes
   (`CLASSROOM_TELEGRAM_INVITE_TTL_MINUTES`). It is shown on screen, and also DM'd if the
   student has ever opened a chat with the bot — **a bot may only message somebody who has
   messaged it first**, which is why the dialog nudges them to say hello to it and why the
   bot answers `/start`. Every DM is a courtesy copy of something the site already shows, so
   a student who never opens that chat loses nothing.
4. Opening the link puts them in the group. If somebody else opens it, that person is removed
   and the ticket is spent — the student comes back for a new one.

## What happens without anybody clicking

| Event | Telegram group | The class on the site |
|---|---|---|
| Account frozen | student removed, outstanding link revoked | **unchanged** — they stay in the class |
| Account unfrozen | nothing automatic | unchanged |
| Removed from the class | student removed | (that *is* the change) |
| Someone else uses a link | that person removed, ticket burned | unchanged |
| A stranger joins some other way | recorded and reported, **not** removed | — |

Unfreezing deliberately does not re-invite anybody. The student presses the button again.

## The two safety rules

The automation is allowed to run unattended because it will not act outside these:

1. **It never removes a Telegram account it cannot match to a student here.** A teacher's
   second account, a parent, the owner of the centre — recorded, reported, left alone. The
   single exception is somebody who walked in on a ticket cut for a different person.
2. **It never removes a chat administrator**, whatever the site believes.

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
