"""Helpers shared by this app's tests. This file holds no tests: it matches ``test*.py``, so
discovery imports it and finds nothing to run. The name stays, because later tests import it."""

from __future__ import annotations

import base64
from contextlib import contextmanager
from datetime import datetime, timedelta
from unittest import mock

from django.utils import timezone

from access import constants as C
from classes import telegram_group_api as real_api
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


class FakeApi:
    """Stands in for `classes.telegram_group_api` inside `telegram_posts.sender`.

    Every call succeeds unless `script` holds answers for that chat: a list of TgResults
    returned in order before the calls start succeeding. ``script["delete:<chat>"]`` does the
    same for `delete_message`.
    """

    TgResult = real_api.TgResult
    largest_photo_file_id = staticmethod(real_api.largest_photo_file_id)

    def __init__(self):
        self.messages: list[tuple[str, str, dict | None]] = []
        self.photos: list[tuple[str, str, str, dict | None]] = []  # (chat, caption, "upload"|file_id, markup)
        self.deleted: list[tuple[str, int]] = []
        self.script: dict[str, list] = {}
        self._next_id = 100

    def is_configured(self):
        return True

    def _answer(self, key, payload):
        queue = self.script.get(key)
        if queue:
            return queue.pop(0)
        self._next_id += 1
        return real_api.TgResult(True, {"message_id": self._next_id, **payload})

    def send_message(self, chat_id, text, *, reply_markup=None):
        result = self._answer(str(chat_id), {})
        if result.ok:
            self.messages.append((str(chat_id), text, reply_markup))
        return result

    def send_photo(self, chat_id, *, caption, photo=None, filename="photo.jpg",
                   content_type="image/jpeg", file_id="", reply_markup=None):
        sizes = {"photo": [{"file_id": "FID-small", "file_size": 10}, {"file_id": "FID-big", "file_size": 999}]}
        result = self._answer(str(chat_id), sizes)
        if result.ok:
            self.photos.append((str(chat_id), caption, file_id or "upload", reply_markup))
        return result

    def delete_message(self, chat_id, message_id):
        result = self._answer(f"delete:{chat_id}", {})
        if result.ok:
            self.deleted.append((str(chat_id), int(message_id)))
        return result


@contextmanager
def fake_api():
    fake = FakeApi()
    with mock.patch("telegram_posts.sender.api", fake):
        yield fake
