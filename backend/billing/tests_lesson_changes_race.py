"""The race between the 15-minute tick and an admin cancelling the same lesson day, on two real connections (review of
2026-11-25, probe D).

The tick writes a day for the first time while an admin cancels it. Without a lock the cancel's void finds nothing yet,
the tick's charge commits after it, and it stays live on a cancelled day for good. Both sides lock the span's row
(``select_for_update``): the cancel waits for the tick, then voids what the tick wrote.

Row locks need PostgreSQL, so these are skipped on SQLite, the usual test run. Run them against a throwaway PostgreSQL:
``DATABASE_URL=postgres://… manage.py test billing.tests_lesson_changes_race --settings=config.settings_test_nomigrations``
without ``LMS_FORCE_SQLITE_FOR_TESTS``.
"""

import threading
import time
from datetime import date
from unittest import mock, skipUnless

from django.contrib.auth import get_user_model
from django.db import connection, transaction
from django.test import TransactionTestCase

from billing import ledger
from billing.models import Entry, EntryKind, Span
from billing.tests_lesson_rule import LESSON_MODE, seat_for, student
from billing.tests_seat_class import make_room
from classes import lesson_changes as L

User = get_user_model()
NOV_30, DEC_2, DEC_4, MON = date(2026, 11, 30), date(2026, 12, 2), date(2026, 12, 4), date(2026, 12, 7)


@skipUnless(connection.vendor == "postgresql", "row locks need PostgreSQL")
@LESSON_MODE
class TickAndCancelRaceTests(TransactionTestCase):
    def test_a_cancel_waits_for_the_tick_writing_that_day_then_voids_it(self):
        admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        room = make_room()
        _, account = student("ali")
        Entry.objects.create(account=account, kind=EntryKind.OPENING, amount=0, day=NOV_30, key="open:ali")
        seat = seat_for(account)
        seat.classroom = room
        seat.save(update_fields=["classroom"])
        span = ledger.start_span(seat, DEC_2, today=DEC_4)  # 2 and 4 December written; Monday 7 not yet
        has_read, go_on, errors = threading.Event(), threading.Event(), []
        real = L.day_changes

        def paused(*args):
            """The tick has read the changes (none yet) and holds the span; it waits here before it writes Monday."""
            found = real(*args)
            has_read.set()
            go_on.wait(10)
            return found

        def tick():
            try:
                with mock.patch("classes.lesson_changes.day_changes", side_effect=paused), transaction.atomic():
                    ledger.bill_span(Span.objects.select_related("seat__account").get(pk=span.pk), MON)
            except Exception as exc:  # noqa: BLE001 - reported by the assertion below
                errors.append(exc)
            finally:
                connection.close()

        def cancel():
            try:
                L.cancel(room, MON, "Teacher ill", by=admin, today=MON)
            except Exception as exc:  # noqa: BLE001 - reported by the assertion below
                errors.append(exc)
            finally:
                connection.close()

        ticking = threading.Thread(target=tick)
        ticking.start()
        self.assertTrue(has_read.wait(10))
        cancelling = threading.Thread(target=cancel)
        cancelling.start()
        time.sleep(1)
        waited = cancelling.is_alive()
        go_on.set()
        ticking.join(10)
        cancelling.join(10)
        self.assertEqual(errors, [])
        monday = Entry.objects.filter(key=f"lesson:{span.pk}:{MON.isoformat()}")
        # (rows, live): Monday was written once, and the cancel voided it, so nothing stays live on a cancelled day.
        self.assertEqual((monday.count(), monday.filter(voided_at__isnull=True).count()), (1, 0))
        self.assertTrue(waited, "the cancel did not wait for the tick holding the span")
