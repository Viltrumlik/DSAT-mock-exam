"""The toolbox's tools (/ops/toolbox), as plain functions: test students, a balance set by hand, a filled register, a
beat task run now, and a one-time "Sign in as" link.

Each goes through the code the console itself uses — ``classes.seat_actions.new_student`` for a student,
``billing.ledger.enter_money`` for money, the beat's own tasks — so nothing here writes money or a seat its own way.
A refusal is a :class:`~staging.timemachine.ToolboxRefused` in words: 400, or 403 for a link that may not be used."""

from __future__ import annotations

import json
import random
import time
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.urls import reverse
from django.utils import timezone

from users.people_detail import display_name

from .timemachine import ToolboxRefused

MAX_STUDENTS = 5
#: Tries at a free test phone, and at a name not yet used in one batch.
MAX_TRIES = 20
#: Same words as the seat actions' own (``classes.views_seats.LOCKED``).
SEATS_LOCKED = "Seats are managed in lc-up until the centre leaves it."
REGISTER_MODES = ("present", "some_absent", "none")
SIGN_IN_SALT = "staging-sign-in"
#: A link works for ten minutes, once; its "used" mark outlives it.
SIGN_IN_MAX_AGE = 10 * 60
SIGN_IN_USED_FOR = 15 * 60
#: The first label of each console's host (``access.host_guard``): a link is made for the right one.
CONSOLE_LABELS = ("admin", "teacher", "questions")

MALE_NAMES = ("Aziz", "Bekzod", "Jasur", "Nodir", "Sardor", "Otabek", "Javohir", "Sherzod")
FEMALE_NAMES = ("Dilnoza", "Kamola", "Madina", "Zarina", "Nilufar", "Sevara", "Gulnoza", "Malika")
#: Each ends as a surname does (``lcup.phones.split_lcup_name``), so "TEST" stays at the front of the name.
SURNAMES = ("Karimov", "Toshmatov", "Rahimov", "Yusupov", "Aliyev", "Qodirov", "Ergashev", "Saidov")


# ── test students ────────────────────────────────────────────────────────────────────────────────────────────────


def _random_phone() -> str:
    """A made-up number, 90 0xx xx xx, written as a login is (``lcup.phones.normalize_phone``)."""
    return f"998900{random.randint(0, 999_999):06d}"


def _held(phone: str) -> bool:
    return get_user_model().objects.filter(
        Q(username__iexact=phone) | Q(phone_number=phone) | Q(parent_phone=phone)
    ).exists()


def _free_phone(avoid: set[str]) -> str:
    for _ in range(MAX_TRIES):
        phone = _random_phone()
        if phone not in avoid and not _held(phone):
            return phone
    raise ToolboxRefused("No free test phone number turned up. Try again.")


def _test_names(taken: set[str]) -> tuple[str, str]:
    """A student's full name not in ``taken`` and a parent's: ``("TEST Kamola Saidova", "TEST Nodir Saidov")``."""
    for _ in range(MAX_TRIES):
        surname, father = random.choice(SURNAMES), random.choice(MALE_NAMES)
        if random.random() < 0.5:
            name = f"TEST {random.choice(MALE_NAMES)} {surname}"
        else:
            name = f"TEST {random.choice(FEMALE_NAMES)} {surname}a"
        if name not in taken:
            return name, f"TEST {father} {surname}"
    raise ToolboxRefused("No new test name turned up. Try again.")


def make_test_students(room, *, status, count, first_payment, by, today) -> list:
    """``count`` (1..5) new students in ``room``, each through the console's own "New student", all or none.
    ``status`` is the seat's: trial (Demo) or active (Paying). With ``first_payment`` an active student pays the least
    the ledger takes from them (a new student's first month in full), in cash."""
    from billing import ledger
    from billing.models import Account, EntryKind, PaymentMethod, Seat
    from billing.views import _after_money
    from classes import seat_actions as S
    from classes.models import ClassroomMembership as M
    from lcup.accounts import PhoneTaken

    if type(count) is not int or not 1 <= count <= MAX_STUDENTS:
        raise ToolboxRefused(f"Make 1 to {MAX_STUDENTS} test students at a time.")
    if status not in (M.SEAT_TRIAL, M.SEAT_ACTIVE):
        raise ToolboxRefused("A test student is on trial (Demo) or active (Paying).")
    users, names, phones = [], set(), set()
    try:
        with transaction.atomic():
            for _ in range(count):
                name, parent_name = _test_names(names)
                for _attempt in range(MAX_TRIES):
                    phone = _free_phone(phones)
                    parent_phone = _free_phone(phones | {phone})
                    try:
                        row = S.new_student(
                            room, full_name=name, phone=phone, status=status, day=today, today=today, by=by,
                            parent_name=parent_name, parent_phone=parent_phone,
                        )
                    except PhoneTaken:  # an open claim holds it, say: another number
                        phones.add(phone)
                        continue
                    break
                else:
                    raise ToolboxRefused("No free test phone number turned up. Try again.")
                names.add(name)
                phones.update((phone, parent_phone))
                if first_payment and status == M.SEAT_ACTIVE:
                    account = Account.objects.get(user=row.user)
                    ledger.enter_money(
                        account, EntryKind.PAYMENT, ledger.least_payment(account), today, request_id=uuid.uuid4().hex,
                        today=today, method=PaymentMethod.CASH, note="TEST first payment", by=by,
                        seat=Seat.objects.filter(account=account, classroom=room).first(),
                    )
                    _after_money(account)
                users.append(row.user)
    except S.SeatsLocked:
        raise ToolboxRefused(SEATS_LOCKED) from None
    except (S.SeatRefused, ledger.EntryRefused) as refused:
        raise ToolboxRefused(str(refused)) from None
    return users


# ── money ────────────────────────────────────────────────────────────────────────────────────────────────────────


def set_balance(user, target, *, by, today) -> int:
    """The balance made exactly ``target`` so'm with one adjustment noted "TEST: …", then the debt freeze as after any
    money (``billing.views._after_money``). Returns the new balance; nothing is written when it already is."""
    from billing import ledger
    from billing.models import Account, EntryKind
    from billing.views import _after_money

    if type(target) is not int:
        raise ToolboxRefused("A balance is a whole number of so'm.")
    account = Account.objects.filter(user=user).first()
    if account is None:
        raise ToolboxRefused(f"{display_name(user)} has no account in the ledger.")
    try:
        with transaction.atomic():
            diff = target - ledger.balance(account)
            if diff:
                ledger.enter_money(
                    account, EntryKind.ADJUST, diff, today, request_id=uuid.uuid4().hex, today=today,
                    note=f"TEST: balance set to {target:,}", by=by,
                )
                _after_money(account)
    except ledger.EntryRefused as refused:
        raise ToolboxRefused(str(refused)) from None
    return ledger.balance(account)


# ── the register ─────────────────────────────────────────────────────────────────────────────────────────────────


def fill_register(room, day, mode, *, by) -> dict:
    """The register of ``room`` on ``day``, opened if it is not, and its students marked as a teacher would: everyone
    present, one or two absent at random, or nothing. The attendance window is not asked on purpose (a test tool)."""
    from classes.models_attendance import AttendanceRecord, AttendanceSession
    from classes.views_attendance import _active_students

    if mode not in REGISTER_MODES:
        raise ToolboxRefused("Mark everyone present, one or two absent, or nothing.")
    with transaction.atomic():
        session, opened = AttendanceSession.objects.get_or_create(
            classroom=room, date=day, defaults={"created_by": by}
        )
        students = [member.user_id for member in _active_students(room, on_date=day)]
        absent = set()
        if mode == "some_absent" and students:
            absent = set(random.sample(students, k=min(len(students), random.randint(1, 2))))
        if mode != "none":
            for student_id in students:
                status = AttendanceRecord.STATUS_ABSENT if student_id in absent else AttendanceRecord.STATUS_PRESENT
                AttendanceRecord.objects.update_or_create(
                    session=session, student_id=student_id, defaults={"status": status, "marked_by": by}
                )
    marked = 0 if mode == "none" else len(students)
    return {
        "session_id": session.pk, "date": day.isoformat(), "opened": opened, "students": len(students),
        "present": marked - len(absent), "absent": len(absent),
    }


# ── the beat ─────────────────────────────────────────────────────────────────────────────────────────────────────


def _schedule_text(schedule) -> str:
    if hasattr(schedule, "_orig_minute"):  # a celery crontab: "m h dom mon dow"
        parts = ("minute", "hour", "day_of_month", "month_of_year", "day_of_week")
        return " ".join(str(getattr(schedule, f"_orig_{part}")) for part in parts)
    seconds = schedule.total_seconds() if isinstance(schedule, timedelta) else schedule
    if isinstance(seconds, (int, float)) and not isinstance(seconds, bool):
        return f"every {int(seconds)}s"
    return str(schedule)


def beat_tasks() -> list[dict]:
    """Every entry of the beat's schedule (``settings.CELERY_BEAT_SCHEDULE``), in its order."""
    return [
        {"name": name, "task": entry["task"], "schedule": _schedule_text(entry.get("schedule"))}
        for name, entry in settings.CELERY_BEAT_SCHEDULE.items()
    ]


def _as_text(value) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return str(value)


def run_task(name: str) -> dict:
    """The task of the beat entry ``name``, run now in this process with the entry's arguments; its result as text."""
    from config import celery_app

    entry = settings.CELERY_BEAT_SCHEDULE.get(name)
    if not entry:
        raise ToolboxRefused(f"There is no beat entry {name!r}.")
    try:
        value = celery_app.tasks[entry["task"]].apply(kwargs=entry.get("kwargs", {})).get()
    except Exception as exc:  # noqa: BLE001 - shown to the person who pressed Run
        return {"name": name, "task": entry["task"], "ok": False, "result": f"{type(exc).__name__}: {exc}"[:2000]}
    return {"name": name, "task": entry["task"], "ok": True, "result": _as_text(value)}


# ── sign in as ───────────────────────────────────────────────────────────────────────────────────────────────────


def side_of(user) -> str:
    """Where a person works: a learner on the main site, a teacher in the Teacher Portal, staff in the console."""
    from access import constants as C
    from access.services import normalized_role

    if getattr(user, "is_superuser", False):
        return "admin"
    role = normalized_role(user)
    if role in C.LEARNER_ROLES:
        return "main"
    if role in C.SUBJECT_SCOPED_STAFF_ROLES:
        return "teacher"
    return "admin"


def console_origin(scheme: str, host: str, side: str) -> str:
    """That side's origin on the copy, from a request's host with its first label swapped: ``admin.X`` → ``X``,
    ``teacher.X`` or ``admin.X``."""
    labels = str(host or "").split(".")
    base = ".".join(labels[1:]) if len(labels) > 1 and labels[0].lower() in CONSOLE_LABELS else str(host or "")
    return f"{scheme}://{base if side == 'main' else f'{side}.{base}'}"


def may_sign_in_as(actor, target) -> bool:
    """Nobody becomes someone with more power than their own: the owner (or a superuser) may open anyone's side, anyone
    else only an account ranked strictly below theirs (``users.account_rank``)."""
    from access import constants as C
    from access.services import normalized_role
    from users.account_rank import account_rank

    if getattr(actor, "is_superuser", False) or normalized_role(actor) == C.ROLE_SUPER_ADMIN:
        return True
    return account_rank(target) < account_rank(actor)


def sign_in_link(user, *, host_for, by=None) -> dict:
    """A link that signs its opener in as ``user`` on their side (``host_for(side)`` is that side's origin), once,
    within ten minutes. It carries who made it (``by``), for the action log when it is used."""
    maker = getattr(by, "pk", None) or 0
    token = signing.TimestampSigner(salt=SIGN_IN_SALT).sign(f"{user.pk}:{maker}:{uuid.uuid4().hex}")
    path = reverse("staging-sign-in", kwargs={"token": token})
    return {"url": f"{host_for(side_of(user))}{path}", "expires_at": timezone.now() + timedelta(seconds=SIGN_IN_MAX_AGE)}


def link_holder(token: str) -> tuple:
    """``(the active person a link names, who made it or None)`` while the link is under ten minutes old. Refused (403)
    otherwise — and when it was signed later than now: after the time machine goes Back, a link made at a later test
    date would have a negative age, which ``max_age`` lets through."""
    signer = signing.TimestampSigner(salt=SIGN_IN_SALT)
    not_valid = ToolboxRefused("This sign-in link is not valid.", status=403)
    try:
        value = signer.unsign(token, max_age=SIGN_IN_MAX_AGE)
        signed_at = signing.b62_decode(token.rsplit(signer.sep, 2)[1])
    except signing.SignatureExpired:
        raise ToolboxRefused("This sign-in link has expired. Make a new one in the toolbox.", status=403) from None
    except (signing.BadSignature, ValueError, IndexError):
        raise not_valid from None
    parts = value.split(":")
    if signed_at > time.time() or len(parts) != 3 or not parts[0].isdigit():
        raise not_valid
    User = get_user_model()
    user = User.objects.filter(pk=int(parts[0]), is_active=True).first()
    if user is None:
        raise ToolboxRefused("This account cannot be signed in to.", status=403)
    maker = User.objects.filter(pk=int(parts[1])).first() if parts[1].isdigit() and int(parts[1]) else None
    return user, maker


def use_link(token: str) -> None:
    """A link works once: whoever opens it first uses it up."""
    if not cache.add(f"stg-signin:{token}", 1, SIGN_IN_USED_FOR):
        raise ToolboxRefused("This sign-in link was already used. Make a new one in the toolbox.", status=403)
