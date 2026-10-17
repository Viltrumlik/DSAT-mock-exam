"""Helpers shared by this app's tests. This file holds no tests: it matches ``test*.py``, so
discovery imports it and finds nothing to run. The name stays, because later tests import it."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta

from django.utils import timezone

from access import constants as C
from classes.models import Classroom
from events.models import Event
from users.models import User

TOKEN = "777:TESTTOKEN"

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def at(y, m, d, h=0, mi=0):
    """A Tashkent wall-clock moment. 2026-10-24 is a Saturday."""
    return timezone.make_aware(datetime(y, m, d, h, mi))


def staff():
    user = User.objects.filter(email="tp_admin@t.com").first()
    return user or User.objects.create_user("tp_admin@t.com", "x", role=C.ROLE_ADMIN)


def make_room(name, *, subject=Classroom.SUBJECT_MATH, level="senior", chat="-1001", active=True):
    return Classroom.objects.create(
        name=name, subject=subject, level=level, lesson_days=Classroom.DAYS_ODD,
        created_by=staff(), telegram_chat_id=chat, is_active=active,
    )


def make_event(**kw):
    start = kw.pop("starts_at", at(2026, 10, 25, 12, 30))
    kw.setdefault("title", "Admission Workshop")
    kw.setdefault("description", "")
    kw.setdefault("ends_at", start + timedelta(hours=1, minutes=30))
    kw.setdefault("location", "MasterSAT, Room 2")
    kw.setdefault("seats", 30)
    kw.setdefault("status", Event.STATUS_PUBLISHED)
    kw.setdefault("published_at", at(2026, 10, 20, 9))
    kw.setdefault("created_by", staff())
    return Event.objects.create(starts_at=start, **kw)
