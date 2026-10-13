"""Who in lc-up is whom on our side.

**An automatic link needs two signals; one signal only proposes.** A phone alone can belong to a
parent who registered two children, and a name alone repeats across a school. So a student links
automatically on phone *and* a shared name token, or — since most of our students never gave us a
phone — on their exact full name inside the class an admin paired with the lc-up group, when they
are the only such student there and their account carries no other phone. A phone with a different
name, a close-but-not-exact name in the paired class, or a phone lc-up itself gives to two children
all go to the admin's review queue with the candidates attached. Teachers are fewer and their
phones are their own, so a unique phone is enough for them.

A user already linked to another lc-up record is never a candidate: one account, one lc-up row.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from django.db.models import F, Q, Value
from django.db.models.functions import Replace

from access import constants as acc_const
from classes.models import Classroom
from users.models import User

from .models import LinkStatus
from .phones import name_tokens, normalize_phone

#: Group → class suggestions below this many points are not offered; the group gets a new class.
SUGGEST_THRESHOLD = 8

_LEVELS = (
    Classroom.LEVEL_FOUNDATION,
    Classroom.LEVEL_JUNIOR,
    Classroom.LEVEL_MIDDLE,
    Classroom.LEVEL_SENIOR,
)
_GROUP_NUMBER = re.compile(r"\bg\d+\b", re.IGNORECASE)
_DAYS = {(1, 3, 5): Classroom.DAYS_ODD, (2, 4, 6): Classroom.DAYS_EVEN}


@dataclass
class MatchResult:
    user_id: int | None
    status: str
    reason: str
    candidates: list[dict] = field(default_factory=list)


@dataclass
class GroupSuggestion:
    classroom_id: int | None
    score: float
    reasons: list[str] = field(default_factory=list)


def _full_name(user) -> str:
    return f"{user.first_name or ''} {user.last_name or ''}".strip()


def _candidate(user, reason: str) -> dict:
    return {"user_id": user.pk, "name": _full_name(user) or (user.username or ""), "reason": reason}


def _digits_only(expression):
    for junk in (" ", "-", "+", "(", ")"):
        expression = Replace(expression, Value(junk), Value(""))
    return expression


def phone_owners(queryset, phone: str) -> list:
    if not phone:
        return []
    # Ours are stored however people typed them ("+998 90 123 45 67"), so strip the separators in
    # SQL to narrow on the last nine digits, then compare the normalised forms exactly in Python.
    narrowed = queryset.annotate(_phone_digits=_digits_only(F("phone_number"))).filter(
        _phone_digits__endswith=phone[-9:]
    )
    return [u for u in narrowed if normalize_phone(u.phone_number) == phone]


#: Why a teacher link is settled as a support teacher. lc-up keeps a support teacher in the
#: ordinary teacher role with ``is_supporter: true`` (owner, 2026-10-13); here they are a
#: ``support_teacher`` who leads no lc-up group, so they are never matched as a group teacher.
SUPPORTER_REASON = "support teacher in lc-up"


def match_supporter(link):
    """Our support teacher account for an lc-up supporter, by phone (one owner only), else None."""
    pool = User.objects.filter(role=acc_const.ROLE_SUPPORT_TEACHER).filter(
        Q(lcup_teacher_link__isnull=True) | Q(lcup_teacher_link=link)
    )
    owners = phone_owners(pool, link.phone)
    return owners[0] if len(owners) == 1 else None


def match_teacher(link) -> MatchResult:
    pool = User.objects.filter(role__in=acc_const.TEACHER_PORTAL_ROLES).filter(
        Q(lcup_teacher_link__isnull=True) | Q(lcup_teacher_link=link)
    )
    owners = phone_owners(pool, link.phone)
    if len(owners) == 1:
        return MatchResult(owners[0].pk, LinkStatus.AUTO, "phone", [_candidate(owners[0], "phone")])
    tokens = name_tokens(link.name)
    by_name = [u for u in pool if tokens and name_tokens(_full_name(u)) == tokens]
    if not owners and len(by_name) == 1:
        return MatchResult(None, LinkStatus.NEEDS_REVIEW, "name only", [_candidate(by_name[0], "name only")])
    candidates = [_candidate(u, "phone") for u in owners] + [_candidate(u, "name only") for u in by_name if u not in owners]
    if candidates:
        return MatchResult(None, LinkStatus.NEEDS_REVIEW, "several candidates", candidates)
    return MatchResult(None, LinkStatus.UNMATCHED, "no match")


def _names_close(a: frozenset, b: frozenset) -> bool:
    return bool(a) and (a == b or len(a & b) >= 2)


def _exact_name_without_another_phone(user, tokens: frozenset) -> bool:
    # Two words at least ("Malika" alone repeats), every word the same, and no phone of their own:
    # a phone equal to lc-up's was matched above, so any phone here is someone else's number.
    return len(tokens) >= 2 and name_tokens(_full_name(user)) == tokens and not (user.phone_number or "").strip()


def match_student(link, *, shared_phones: set[str], class_user_ids: set[int]) -> MatchResult:
    pool = User.objects.filter(role=acc_const.ROLE_STUDENT).filter(
        Q(lcup_student_link__isnull=True) | Q(lcup_student_link=link)
    )
    tokens = name_tokens(link.name)
    owners = phone_owners(pool, link.phone)

    if link.phone and link.phone in shared_phones:
        return MatchResult(
            None, LinkStatus.NEEDS_REVIEW, "phone shared by siblings in lc-up", [_candidate(u, "phone") for u in owners]
        )
    if len(owners) > 1:
        return MatchResult(
            None, LinkStatus.NEEDS_REVIEW, "several accounts carry this phone", [_candidate(u, "phone") for u in owners]
        )
    if len(owners) == 1:
        user = owners[0]
        if tokens & name_tokens(_full_name(user)):
            return MatchResult(user.pk, LinkStatus.AUTO, "phone + name", [_candidate(user, "phone + name")])
        return MatchResult(
            None, LinkStatus.NEEDS_REVIEW, "phone matches, name differs", [_candidate(user, "phone, name differs")]
        )
    if class_user_ids:
        in_class = [u for u in pool.filter(pk__in=class_user_ids) if _names_close(tokens, name_tokens(_full_name(u)))]
        if len(in_class) == 1 and _exact_name_without_another_phone(in_class[0], tokens):
            return MatchResult(
                in_class[0].pk,
                LinkStatus.AUTO,
                "exact name in paired class",
                [_candidate(in_class[0], "exact name in paired class")],
            )
        if len(in_class) == 1:
            return MatchResult(
                None, LinkStatus.NEEDS_REVIEW, "name in paired class", [_candidate(in_class[0], "name in paired class")]
            )
        if in_class:
            return MatchResult(
                None,
                LinkStatus.NEEDS_REVIEW,
                "several names in paired class",
                [_candidate(u, "name in paired class") for u in in_class],
            )
    return MatchResult(None, LinkStatus.UNMATCHED, "no match")


# ── groups ────────────────────────────────────────────────────────────────


def _texts(snapshot: dict) -> tuple[str, str]:
    course = str((snapshot.get("course") or {}).get("name") or "").casefold()
    return course, str(snapshot.get("name") or "").casefold()


def subject_from(snapshot: dict) -> str | None:
    """The course name decides; the group name is the fallback (lc-up names both)."""
    for text in _texts(snapshot):
        if "math" in text:
            return Classroom.SUBJECT_MATH
        if "english" in text:
            return Classroom.SUBJECT_ENGLISH
    return None


def level_from(snapshot: dict) -> str:
    for text in _texts(snapshot):
        for level in _LEVELS:
            if re.search(rf"\b{level}\b", text):
                return level
    return ""


def days_from(snapshot: dict) -> str | None:
    try:
        days = tuple(sorted(int(d) for d in (snapshot.get("days") or [])))
    except (TypeError, ValueError):
        return None
    return _DAYS.get(days)


def _group_number(snapshot: dict) -> str | None:
    found = _GROUP_NUMBER.search(str(snapshot.get("name") or ""))
    return found.group(0).casefold() if found else None


def suggest_classroom(
    snapshot: dict, *, teacher_user_ids: set[int], branch_id: int | None, taken_classroom_ids: set[int]
) -> GroupSuggestion:
    subject, level, days = subject_from(snapshot), level_from(snapshot), days_from(snapshot)
    start = str(snapshot.get("start_time") or "")[:5]
    number = _group_number(snapshot)

    best: GroupSuggestion | None = None
    for room in Classroom.objects.filter(is_active=True).exclude(pk__in=taken_classroom_ids).order_by("pk"):
        score, reasons = 0, []
        if subject and room.subject == subject:
            score, reasons = score + 3, reasons + ["subject"]
        if level and room.level == level:
            score, reasons = score + 3, reasons + ["level"]
        if days and room.lesson_days == days:
            score, reasons = score + 2, reasons + ["days"]
        if start and start in (room.lesson_time or ""):
            score, reasons = score + 1, reasons + ["time"]
        if room.teacher_id and room.teacher_id in teacher_user_ids:
            score, reasons = score + 2, reasons + ["teacher"]
        if branch_id and room.branch_id == branch_id:
            score, reasons = score + 1, reasons + ["branch"]
        if number and re.search(rf"\b{re.escape(number)}\b", room.name.casefold()):
            score, reasons = score + 2, reasons + [f"number {number.upper()}"]
        if best is None or score > best.score:
            best = GroupSuggestion(room.pk, score, reasons)

    if best and best.score >= SUGGEST_THRESHOLD:
        return best
    return GroupSuggestion(None, best.score if best else 0, best.reasons if best else [])
