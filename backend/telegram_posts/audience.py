"""Which class groups a post reaches.

Only active classes with a chat id, and one target per chat: two classes that share a group get
one message there, not two — the same rule as `announce_classroom_bot`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from classes.models import Classroom
from classes.telegram_group import chat_id_for

from .models import GroupPost

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


def post_audience(post) -> dict:
    """{"subjects", "levels", "classroom_ids"}: who the post reaches, as the sender will resolve it.

    The one answer the sender (`for_post`) and the console (its label and its lists) share.
    An event reminder reads the event when it goes out, like its start time: the audience the
    event names now, not the copy taken at Publish. The announcement keeps its copy — it was
    sent at Publish. An event audience that cannot be read falls back to the post's own copy.
    """
    own = {
        "subjects": list(post.subjects or []),
        "levels": list(post.levels or []),
        "classroom_ids": list(post.classroom_ids or []),
    }
    if post.kind != GroupPost.KIND_EVENT_REMINDER or not post.event_id:
        return own
    try:
        chosen = normalize(post.event.telegram_audience)
    except (ValueError, TypeError):
        return own
    return {**chosen, "classroom_ids": []}


def for_post(post) -> list[Target]:
    return resolve(**post_audience(post))


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
    """Every class a post can reach, for the console's audience picker and its group count.

    A chat id that is only spaces is no group, so the class is no row: `resolve` drops it too.
    """
    rows = []
    for r in _rooms():
        chat = chat_id_for(r)
        if chat:
            rows.append(
                {"id": r.pk, "name": r.name, "subject": r.subject, "level": r.level, "chat_id": chat}
            )
    return rows


def normalize(value) -> dict:
    """{"subjects": [...], "levels": [...]} from what a form sent (a dict, or a JSON string).

    Raises ValueError naming the bad value. Sorted in a fixed order, so the same choice is
    always stored the same way.
    """
    if value in (None, ""):
        return {"subjects": [], "levels": []}
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ValueError('Expected {"subjects": [...], "levels": [...]}.')
    subjects = [str(s) for s in value.get("subjects") or []]
    levels = [str(level) for level in value.get("levels") or []]
    bad = [s for s in subjects if s not in SUBJECTS] + [lv for lv in levels if lv not in LEVELS]
    if bad:
        raise ValueError(f"Unknown subject or level: {', '.join(bad)}.")
    return {
        "subjects": sorted(set(subjects), key=SUBJECTS.index),
        "levels": sorted(set(levels), key=LEVELS.index),
    }
