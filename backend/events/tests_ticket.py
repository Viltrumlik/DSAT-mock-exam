"""The ticket: its code, and the lookup the door runs on."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from access import constants as C
from events import services
from events.models import Event, EventRegistration

User = get_user_model()


class TicketFixture(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("tk_ops@t.com", "secret123", role=C.ROLE_ADMIN)
        self.anna = User.objects.create_user(
            "tk_anna@t.com", "secret123", role=C.ROLE_STUDENT,
            first_name="Anna", last_name="Karimova",
        )
        self.now = timezone.now()
        self.event = Event.objects.create(
            title="Robotics open day",
            starts_at=self.now + timedelta(days=2),
            ends_at=self.now + timedelta(days=2, hours=2),
            location="Fergana city branch, room 3",
            seats=30,
            status=Event.STATUS_PUBLISHED,
            published_at=self.now - timedelta(days=1),
            created_by=self.staff,
        )
        self.row = services.sign_up(self.event, self.anna, now=self.now)


class TicketCodeTests(TicketFixture):
    def test_signing_up_mints_a_code(self):
        self.assertEqual(len(self.row.ticket_code), 8)

    def test_the_code_carries_no_letter_anybody_could_misread(self):
        # No O/0, I/1, L or U: it is read off a phone screen and typed by hand.
        self.assertFalse(set(self.row.ticket_code) & set("O0I1LU"))

    def test_every_code_is_its_own(self):
        boris = User.objects.create_user("tk_boris@t.com", "secret123", role=C.ROLE_STUDENT)
        other = services.sign_up(self.event, boris, now=self.now)

        self.assertNotEqual(self.row.ticket_code, other.ticket_code)

    def test_cancelling_and_signing_up_again_keeps_one_code(self):
        code = self.row.ticket_code
        services.cancel_registration(self.row, now=self.now)

        again = services.sign_up(self.event, self.anna, now=self.now)

        self.assertEqual(again.ticket_code, code)

    def test_it_is_shown_with_a_dash_and_read_without_one(self):
        pretty = services.format_ticket_code(self.row.ticket_code)

        self.assertEqual(pretty, f"{self.row.ticket_code[:4]}-{self.row.ticket_code[4:]}")


class TicketLookupTests(TicketFixture):
    def test_the_code_finds_the_seat(self):
        found = services.find_by_ticket_code(self.row.ticket_code)

        self.assertEqual(found.pk, self.row.pk)

    def test_dashes_spaces_and_lower_case_all_work(self):
        code = self.row.ticket_code
        spelled = f" {code[:4].lower()}-{code[4:].lower()} "

        self.assertEqual(services.find_by_ticket_code(spelled).pk, self.row.pk)

    def test_an_unknown_code_finds_nothing(self):
        self.assertIsNone(services.find_by_ticket_code("2222-2222"))

    def test_an_empty_code_finds_nothing_rather_than_the_first_row(self):
        for value in ("", None, "   "):
            with self.subTest(value):
                self.assertIsNone(services.find_by_ticket_code(value))


class AdminRegistrationTicketCodeTests(TicketFixture):
    """R3: the ops attendance list carries the same code, in the same display form."""

    def test_the_ops_list_carries_the_code_too(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(self.staff)

        response = client.get(f"/api/events/admin/{self.event.id}/registrations/")

        rows = response.json()["registrations"]
        row = next(r for r in rows if r["id"] == self.row.id)
        code = self.row.ticket_code
        self.assertEqual(row["ticket_code"], f"{code[:4]}-{code[4:]}")


class TicketMigrationBackfillTests(TicketFixture):
    """R10: the migration's own backfill, proven directly — the fast test settings never
    run migrations, so this is the only thing that actually exercises `backfill`."""

    def test_backfill_gives_every_row_its_own_distinct_code(self):
        import importlib

        import django.apps

        migration = importlib.import_module("events.migrations.0002_ticket_code")

        boris = User.objects.create_user("tk_boris3@t.com", "secret123", role=C.ROLE_STUDENT)
        carla = User.objects.create_user("tk_carla3@t.com", "secret123", role=C.ROLE_STUDENT)
        services.sign_up(self.event, boris, now=self.now)
        services.sign_up(self.event, carla, now=self.now)

        EventRegistration.objects.update(ticket_code=None)
        migration.backfill(django.apps.apps, None)

        codes = list(EventRegistration.objects.values_list("ticket_code", flat=True))
        self.assertEqual(len(codes), 3)
        for code in codes:
            self.assertEqual(len(code), 8)
            self.assertLessEqual(set(code), set(services.TICKET_ALPHABET))
        self.assertEqual(len(codes), len(set(codes)))
