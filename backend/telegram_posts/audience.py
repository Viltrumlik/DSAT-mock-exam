"""Which class groups a post reaches.

Only active classes with a chat id, and one target per chat: two classes that share a group get
one message there, not two — the same rule as `announce_classroom_bot`.
"""

from __future__ import annotations

from dataclasses import dataclass

from classes.models import Classroom
from classes.telegram_group import chat_id_for

SUBJECTS = (Classroom.SUBJECT_MATH, Classroom.SUBJECT_ENGLISH)
LEVELS = tuple(code for code, _label in Classroom.LEVEL_CHOICES)


@dataclass(frozen=True)
class Target:
    chat_id: str
    #: The classes in that chat, comma-separated, for the console's per-group rows.
    names: str


def _rooms():
    return (
        Classroom.objects.filter(is_active=True)
        .exclude(telegram_chat_id="")
        .order_by("pk")
    )


def resolve(*, subjects=(), levels=(), classroom_ids=()) -> list[Target]:
    rooms = _rooms()
    if classroom_ids:
        rooms = rooms.filter(pk__in=list(classroom_ids))
    else:
        if subjects:
            rooms = rooms.filter(subject__in=list(subjects))
        if levels:
            rooms = rooms.filter(level__in=list(levels))
    by_chat: dict[str, list[str]] = {}
    for room in rooms:
        chat = chat_id_for(room)
        if chat:
            by_chat.setdefault(chat, []).append(room.name)
    return [Target(chat, ", ".join(names)[:300]) for chat, names in by_chat.items()]


def for_post(post) -> list[Target]:
    return resolve(
        subjects=post.subjects or (), levels=post.levels or (), classroom_ids=post.classroom_ids or ()
    )


def label(*, subjects=(), levels=(), classroom_ids=()) -> str:
    """The audience in a few words, for the console's list."""
    if classroom_ids:
        n = len(classroom_ids)
        return f"{n} chosen group{'' if n == 1 else 's'}"
    if not subjects and not levels:
        return "All groups"
    who = " + ".join(s.title() for s in subjects) if subjects else "All subjects"
    tier = ", ".join(levels) if levels else "all levels"
    return f"{who} · {tier}"


def picker_rows() -> list[dict]:
    """Every class a post can reach, for the console's audience picker and its group count."""
    return [
        {"id": r.pk, "name": r.name, "subject": r.subject, "level": r.level, "chat_id": chat_id_for(r)}
        for r in _rooms()
    ]
