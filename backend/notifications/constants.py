"""What a notification can be about — the sections the inbox is divided into.

Categories are the sectioning axis the school asked for, so they are chosen to match how a
student thinks about their week rather than which Django app raised the event. "My grade came
back" and "my homework was marked" are the same category to a student even though they come
from different tables.

Events are finer-grained than categories and are the machine-readable half: the category
decides which section a row lands in, the event decides the icon and lets a later feature
filter on one kind of thing without re-deriving it from a title string.
"""

from __future__ import annotations

# ── Categories (the inbox sections) ───────────────────────────────────────────

CATEGORY_GRADES = "GRADES"
CATEGORY_HOMEWORK = "HOMEWORK"
CATEGORY_CLASSROOM = "CLASSROOM"
CATEGORY_EXAMS = "EXAMS"
CATEGORY_SUPPORT = "SUPPORT"
CATEGORY_REWARDS = "REWARDS"
CATEGORY_SYSTEM = "SYSTEM"

CATEGORY_CHOICES = [
    (CATEGORY_GRADES, "Grades"),
    (CATEGORY_HOMEWORK, "Homework"),
    (CATEGORY_CLASSROOM, "Classroom"),
    (CATEGORY_EXAMS, "Exams"),
    (CATEGORY_SUPPORT, "Support"),
    (CATEGORY_REWARDS, "Rewards & Shop"),
    (CATEGORY_SYSTEM, "System"),
]

ALL_CATEGORIES = tuple(code for code, _ in CATEGORY_CHOICES)

#: The order sections appear in. Grades first because it is the one a student opens the bell
#: for; System last because it is the one they open it despite.
CATEGORY_ORDER = (
    CATEGORY_GRADES,
    CATEGORY_HOMEWORK,
    CATEGORY_EXAMS,
    CATEGORY_CLASSROOM,
    CATEGORY_SUPPORT,
    CATEGORY_REWARDS,
    CATEGORY_SYSTEM,
)

# ── Events ────────────────────────────────────────────────────────────────────

EVENT_HOMEWORK_GRADED = "HOMEWORK_GRADED"
EVENT_HOMEWORK_ASSIGNED = "HOMEWORK_ASSIGNED"
EVENT_HOMEWORK_DUE_SOON = "HOMEWORK_DUE_SOON"
EVENT_MIDTERM_RESULT = "MIDTERM_RESULT"
EVENT_MIDTERM_SCHEDULED = "MIDTERM_SCHEDULED"
EVENT_CERTIFICATE_READY = "CERTIFICATE_READY"
EVENT_CLASS_ANNOUNCEMENT = "CLASS_ANNOUNCEMENT"
EVENT_COMMENT_REPLY = "COMMENT_REPLY"
EVENT_SUPPORT_BOOKED = "SUPPORT_BOOKED"
EVENT_SUPPORT_CANCELLED = "SUPPORT_CANCELLED"
EVENT_SUPPORT_REMINDER = "SUPPORT_REMINDER"
EVENT_REWARD_EARNED = "REWARD_EARNED"
EVENT_SHOP_ORDER_READY = "SHOP_ORDER_READY"
EVENT_STRIKE_LOST = "STRIKE_LOST"
EVENT_SYSTEM = "SYSTEM"

#: Which section each event files itself under. A missing event lands in SYSTEM rather than
#: raising — a notification that cannot be categorised should still reach the student.
EVENT_CATEGORY = {
    EVENT_HOMEWORK_GRADED: CATEGORY_GRADES,
    EVENT_MIDTERM_RESULT: CATEGORY_GRADES,
    EVENT_CERTIFICATE_READY: CATEGORY_GRADES,
    EVENT_HOMEWORK_ASSIGNED: CATEGORY_HOMEWORK,
    EVENT_HOMEWORK_DUE_SOON: CATEGORY_HOMEWORK,
    EVENT_MIDTERM_SCHEDULED: CATEGORY_EXAMS,
    EVENT_CLASS_ANNOUNCEMENT: CATEGORY_CLASSROOM,
    EVENT_COMMENT_REPLY: CATEGORY_CLASSROOM,
    EVENT_SUPPORT_BOOKED: CATEGORY_SUPPORT,
    EVENT_SUPPORT_CANCELLED: CATEGORY_SUPPORT,
    EVENT_SUPPORT_REMINDER: CATEGORY_SUPPORT,
    EVENT_REWARD_EARNED: CATEGORY_REWARDS,
    EVENT_SHOP_ORDER_READY: CATEGORY_REWARDS,
    EVENT_STRIKE_LOST: CATEGORY_REWARDS,
    EVENT_SYSTEM: CATEGORY_SYSTEM,
}

EVENT_CHOICES = [(code, code.replace("_", " ").title()) for code in EVENT_CATEGORY]


def category_for(event: str) -> str:
    return EVENT_CATEGORY.get(event, CATEGORY_SYSTEM)


#: Events that must reach a phone, not just the bell. Everything else is in-app only.
#:
#: Kept short on purpose. A push notification interrupts somebody, and a platform that pushes
#: every reward and every comment reply teaches students to turn push off — after which the
#: one that mattered does not arrive either.
PUSH_EVENTS = frozenset({
    EVENT_HOMEWORK_GRADED,
    EVENT_HOMEWORK_ASSIGNED,
    EVENT_HOMEWORK_DUE_SOON,
    EVENT_MIDTERM_RESULT,
    EVENT_MIDTERM_SCHEDULED,
    EVENT_CERTIFICATE_READY,
    EVENT_SUPPORT_BOOKED,
    EVENT_SUPPORT_CANCELLED,
    EVENT_SUPPORT_REMINDER,
    EVENT_SHOP_ORDER_READY,
})
