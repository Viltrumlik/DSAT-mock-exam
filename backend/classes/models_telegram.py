"""The class Telegram group, as the site sees it.

A classroom already carries two Telegram fields: ``telegram_chat_id`` (the numeric id of
the group the bot posts into) and ``telegram_group_url`` (a static invite link pasted into
the header). The static link is the thing this module replaces for classes that opt in. A
link anybody can forward is not a door — it is a hole: the class group filled with siblings,
friends and ex-students, and nothing on the site could tell who was behind it.

So a join becomes a **ticket**. The site issues one single-use invite link per student per
classroom, records which account it was minted for, and when Telegram reports the join it
checks that the Telegram account which walked through the door is the one the ticket was cut
for. Anyone else is removed on the spot.

A group that already has people in it when a class is switched over is not disturbed. The
bot never watched those accounts arrive, so it does not act on them at all — it does not
even know they are there. Watching begins at the first join it sees. If one of them leaves
and comes back, *that* arrival is watched, and from then on they are managed like anybody
else. ``observed_arrival_at`` below is the whole of that mechanism.

Two models:

``ClassroomTelegramMember`` is current state — one row per person per class group, the
answer to "is this student in the group, and should they be?". ``user`` is nullable on
purpose: the bot also sees people join who match no site account at all (a teacher, a
parent, someone's second account), and a row with a Telegram id and no user is exactly how
that fact gets recorded rather than lost.

``ClassroomTelegramEvent`` is history — append-only, never updated. Modelled on
``ClassroomMembershipEvent`` next door and for the same reason: a student who finds
themselves outside the group will ask why, and "the bot removed you at 19:04 because your
account was frozen" is an answer. "Some automation did something" is not.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q


class ClassroomTelegramMember(models.Model):
    #: A single-use link has been minted and handed to the student; they have not walked
    #: through it yet. Nothing has been granted at this point — the ticket can expire unused.
    STATUS_PENDING = "PENDING"
    STATUS_JOINED = "JOINED"
    #: They left of their own accord. Distinct from REMOVED because the remedy differs: a
    #: student who left can simply ask for a new link, and nobody needs to be told why.
    STATUS_LEFT = "LEFT"
    #: *We* took them out. ``removed_reason`` says what for.
    STATUS_REMOVED = "REMOVED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Invite issued"),
        (STATUS_JOINED, "In the group"),
        (STATUS_LEFT, "Left the group"),
        (STATUS_REMOVED, "Removed from the group"),
    ]

    REASON_FROZEN = "FROZEN"
    REASON_NOT_IN_CLASS = "NOT_IN_CLASS"
    REASON_IDENTITY_MISMATCH = "IDENTITY_MISMATCH"
    REASON_MANUAL = "MANUAL"
    REASON_CHOICES = [
        (REASON_FROZEN, "Account frozen on the site"),
        (REASON_NOT_IN_CLASS, "No longer a member of the class"),
        (REASON_IDENTITY_MISMATCH, "Joined with a different Telegram account"),
        (REASON_MANUAL, "Removed by staff"),
    ]

    classroom = models.ForeignKey(
        "classes.Classroom", on_delete=models.CASCADE, related_name="telegram_members"
    )
    #: Null for a Telegram account the bot has seen in the group but cannot match to anyone
    #: here. Those rows are reported, never acted on — see ``classes.telegram_group``.
    #:
    #: SET_NULL rather than CASCADE, which is the opposite of ``ClassroomMembership`` next
    #: door and deliberately so. Deleting an account does not delete that person out of a
    #: Telegram group — they are still sitting in it. Cascading would destroy the only record
    #: that they are there, and since the Bot API cannot list a group's members the site
    #: would have no way of ever noticing them again. Left as a null-user row they show up in
    #: the staff roster as an unrecognised account, with their Telegram handle, for somebody
    #: to remove by hand. The bot will not remove them itself: after the delete it genuinely
    #: cannot account for them, and that is exactly the case rule 1 exists for.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="classroom_telegram_members",
    )
    #: The Telegram account this row is about, as Telegram numbers them. Stamped as soon as
    #: a ticket is cut (from the student's linked account) and confirmed by the join update.
    #:
    #: Stamped early ON PURPOSE, even though it then records an expectation before an
    #: observation: it is what stops one person ending up with two rows — an anonymous
    #: sighting keyed on the Telegram id, and their own row keyed on the user — which the
    #: unique constraints below make impossible to reconcile after the fact.
    #:
    #: It is NOT what the identity check compares against. That check reads
    #: ``ticket.user.telegram_id``, the account the student proved they control.
    telegram_user_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    telegram_username = models.CharField(max_length=64, blank=True, default="")
    telegram_display_name = models.CharField(max_length=200, blank=True, default="")

    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True
    )

    #: The single-use link currently outstanding for this student, verbatim as Telegram
    #: minted it. Verbatim matters: the join update identifies the link by its URL and
    #: nothing else, so this string IS the ticket lookup key.
    invite_link = models.CharField(max_length=300, blank=True, default="", db_index=True)
    invite_expires_at = models.DateTimeField(null=True, blank=True)
    invite_issued_at = models.DateTimeField(null=True, blank=True)
    #: How many links this student has been given for this class. Not a limit — a counter.
    #: A student on their fifth link either keeps losing it or keeps being frozen, and both
    #: are worth being able to see.
    invite_issued_count = models.PositiveIntegerField(default=0)

    #: When the bot **watched** this account walk into the group: a ``chat_member`` update it
    #: received, not a conclusion it drew. Null means the site has never seen them arrive —
    #: they were in the group before the bot began watching it — and rule 3 leaves those
    #: people alone for good.
    #:
    #: Deliberately not the same fact as ``joined_at``, which is the softer "we believe they
    #: are in the group" and gets filled in from a ``getChatMember`` probe as well. A probe
    #: can tell you somebody is inside; it cannot tell you they came in on your watch. Only
    #: an observed arrival writes this field, which is what makes it safe to enforce on.
    observed_arrival_at = models.DateTimeField(null=True, blank=True)

    joined_at = models.DateTimeField(null=True, blank=True)
    left_at = models.DateTimeField(null=True, blank=True)
    removed_at = models.DateTimeField(null=True, blank=True)
    removed_reason = models.CharField(
        max_length=24, choices=REASON_CHOICES, blank=True, default=""
    )
    #: Last time the sweep confirmed with Telegram that this row is true.
    last_checked_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "classroom_telegram_members"
        ordering = ["-updated_at"]
        constraints = [
            # Partial, because ``user`` is nullable and the unmatched-Telegram-account rows
            # must be free to pile up. Postgres treats NULLs as distinct under a plain unique
            # index, so this would "work" without the condition — but stating it makes the
            # intent readable instead of resting on a subtlety.
            models.UniqueConstraint(
                fields=["classroom", "user"],
                condition=Q(user__isnull=False),
                name="uniq_classroom_telegram_member_user",
            ),
            models.UniqueConstraint(
                fields=["classroom", "telegram_user_id"],
                condition=Q(telegram_user_id__isnull=False),
                name="uniq_classroom_telegram_member_tg",
            ),
        ]

    def __str__(self) -> str:
        who = self.user_id or f"tg:{self.telegram_user_id}"
        return f"{who} in class {self.classroom_id} ({self.status})"

    @property
    def is_in_group(self) -> bool:
        return self.status == self.STATUS_JOINED

    @property
    def is_watched(self) -> bool:
        """Did the bot see this account come in? Nobody else is ever removed."""
        return self.observed_arrival_at is not None


class ClassroomTelegramEvent(models.Model):
    """Append-only: one row per thing the integration did, and why."""

    ACTION_LINK_ISSUED = "LINK_ISSUED"
    ACTION_JOINED = "JOINED"
    ACTION_JOIN_REJECTED = "JOIN_REJECTED"
    ACTION_REMOVED = "REMOVED"
    ACTION_LEFT = "LEFT"
    ACTION_RECONCILED = "RECONCILED"
    ACTION_UNMANAGED_JOIN = "UNMANAGED_JOIN"
    ACTION_CONFIG_ERROR = "CONFIG_ERROR"
    ACTION_CHOICES = [
        (ACTION_LINK_ISSUED, "One-time invite link issued"),
        (ACTION_JOINED, "Joined the group"),
        (ACTION_JOIN_REJECTED, "Join rejected and removed"),
        (ACTION_REMOVED, "Removed from the group"),
        (ACTION_LEFT, "Left the group"),
        (ACTION_RECONCILED, "State corrected by the sweep"),
        (ACTION_UNMANAGED_JOIN, "Unrecognised account joined"),
        (ACTION_CONFIG_ERROR, "Group is misconfigured"),
    ]

    # SET_NULL throughout, and names copied in beside each key: deleting a class or an
    # account must not delete the record of what was done to it. Same rule, same reasoning,
    # as ``ClassroomMembershipEvent``.
    classroom = models.ForeignKey(
        "classes.Classroom", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="telegram_events",
    )
    classroom_name = models.CharField(max_length=200, blank=True, default="")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="classroom_telegram_events",
    )
    user_name = models.CharField(max_length=200, blank=True, default="")
    telegram_user_id = models.BigIntegerField(null=True, blank=True)

    action = models.CharField(max_length=20, choices=ACTION_CHOICES, db_index=True)
    reason = models.CharField(max_length=24, blank=True, default="")
    detail = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "classroom_telegram_events"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.action} {self.user_name or self.telegram_user_id} @ {self.classroom_name}"
