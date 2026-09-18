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


class TicketRenderTests(TicketFixture):
    """The card's data and its fallback. The Chromium path is NOT exercised: CI has no
    browser, and the certificate suite already guards that renderer with a skipUnless."""

    def test_the_context_carries_what_the_door_needs(self):
        from events import ticket

        context = ticket.build_context(self.row)

        self.assertEqual(context["student_name"], "Anna Karimova")
        self.assertEqual(context["event_title"], "Robotics open day")
        self.assertEqual(context["location"], "Fergana city branch, room 3")
        self.assertEqual(
            context["ticket_code"], services.format_ticket_code(self.row.ticket_code)
        )
        self.assertIn(self.row.ticket_code, context["check_url"])

    def test_the_qr_points_at_the_ops_console_host(self):
        from django.test import override_settings

        from events import ticket

        with override_settings(OPS_SITE_URL="https://admin.example.test"):
            url = ticket.check_url(self.row.ticket_code)

        # The ops pages' API calls are only allowed on that host, so a QR aimed anywhere else
        # opens a page that 403s the moment it loads.
        self.assertTrue(url.startswith("https://admin.example.test/ops/events/check/"))

    def test_the_html_names_the_student_and_the_code(self):
        from events import ticket

        html = ticket.render_html(self.row)

        self.assertIn("Anna Karimova", html)
        self.assertIn(services.format_ticket_code(self.row.ticket_code), html)
        self.assertIn("data:image/svg+xml", html)  # the QR, inline

    def test_the_fallback_draws_a_real_png(self):
        from events import ticket

        data = ticket.render_png_fallback(self.row)

        self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertGreater(len(data), 2000)

    def test_a_broken_browser_falls_back_rather_than_failing_the_download(self):
        from unittest.mock import patch

        from events import ticket

        with patch.object(ticket, "_render_png_chromium", side_effect=RuntimeError("no browser")):
            data = ticket.render_png(self.row)

        self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))


class TicketFontTests(TicketFixture):
    """R4: the ticket embeds its own fonts (lifted from the certificate template) rather
    than relying on a system stack."""

    def test_the_extracted_rules_mention_both_families(self):
        from events import ticket

        rules = ticket._embedded_font_faces()

        self.assertIn("Plus Jakarta Sans", rules)
        self.assertIn("Space Mono", rules)

    def test_the_rendered_html_carries_the_font_face_rules(self):
        from events import ticket

        html = ticket.render_html(self.row)

        self.assertIn("@font-face", html)


class TicketEndpointTests(TicketFixture):
    def setUp(self):
        super().setUp()
        from rest_framework.test import APIClient

        self.client = APIClient()
        self.boris = User.objects.create_user("tk_boris2@t.com", "secret123", role=C.ROLE_STUDENT)

    def _as(self, user):
        self.client.force_authenticate(user)
        return self.client

    def test_a_student_downloads_their_own_ticket(self):
        from unittest.mock import patch

        from events import ticket

        with patch.object(ticket, "render_png", return_value=b"\x89PNG\r\n\x1a\nstub"):
            response = self._as(self.anna).get(f"/api/events/{self.event.id}/ticket.png")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertIn("attachment", response["Content-Disposition"])

    def test_somebody_else_s_ticket_is_404(self):
        self.assertEqual(
            self._as(self.boris).get(f"/api/events/{self.event.id}/ticket.png").status_code, 404
        )

    def test_a_cancelled_seat_has_no_ticket(self):
        services.cancel_registration(self.row, now=self.now)

        self.assertEqual(
            self._as(self.anna).get(f"/api/events/{self.event.id}/ticket.png").status_code, 404
        )


class OpsTicketLookupTests(TicketFixture):
    def setUp(self):
        super().setUp()
        from rest_framework.test import APIClient

        self.client = APIClient()
        self.code = services.format_ticket_code(self.row.ticket_code)

    def _as(self, user):
        self.client.force_authenticate(user)
        return self.client

    def _lookup(self, user, code=None):
        return self._as(user).get(f"/api/events/admin/tickets/{code or self.code}/")

    def test_a_student_cannot_resolve_a_code(self):
        # A stranger who scans a ticket meets the sign-in screen, not a name.
        self.assertEqual(self._lookup(self.anna).status_code, 403)

    def test_staff_get_the_name_and_the_event(self):
        body = self._lookup(self.staff).json()

        self.assertEqual(body["student_name"], "Anna Karimova")
        self.assertEqual(body["event"]["id"], self.event.id)
        self.assertEqual(body["registration_id"], self.row.id)

    def test_it_says_when_marking_is_still_too_early_and_why(self):
        body = self._lookup(self.staff).json()

        self.assertFalse(body["can_mark"])
        self.assertEqual(body["reason"], "too_early")

    def test_a_cancelled_seat_says_so(self):
        services.cancel_registration(self.row, now=self.now)

        body = self._lookup(self.staff).json()

        self.assertEqual((body["can_mark"], body["reason"]), (False, "cancelled"))

    def test_an_unknown_code_is_404(self):
        self.assertEqual(self._lookup(self.staff, code="2222-2222").status_code, 404)

    def test_a_marked_ticket_reports_who_marked_it_and_when(self):
        services.mark_attendance(
            self.row,
            EventRegistration.ATTENDANCE_ATTENDED,
            actor=self.staff,
            now=self.event.starts_at,
        )

        body = self._lookup(self.staff).json()

        self.assertEqual(body["attendance"], EventRegistration.ATTENDANCE_ATTENDED)
        self.assertTrue(body["marked_at"])
        self.assertTrue(body["marked_by_name"])


class TicketLookupThenMarkTests(TicketFixture):
    """R5: the code the door reads resolves to the same seat the EXISTING attendance
    endpoint marks — proven end to end, through both endpoints, exactly once paid."""

    def test_resolving_the_code_then_marking_attendance_pays_exactly_once(self):
        from rest_framework.test import APIClient

        from rewards import constants as RC
        from rewards.models import PointAward, RewardRule

        RewardRule.objects.get_or_create(
            event=RC.EVENT_ATTENDED, defaults={"points": 10, "grants_xp": True}
        )

        # Close enough to "now" that marking_opens_at (starts_at - CANCEL_CUTOFF) has already
        # passed by the time the requests below run for real — the attendance endpoint always
        # reads the real clock rather than accepting one, so this moves the clock the same way
        # tests_attendance.py and tests_api_ops.py do: by placing `starts_at` relative to it.
        soon = Event.objects.create(
            title="Career talk",
            starts_at=self.now + timedelta(minutes=1),
            ends_at=self.now + timedelta(hours=1),
            seats=10,
            status=Event.STATUS_PUBLISHED,
            published_at=self.now - timedelta(days=1),
            created_by=self.staff,
        )
        row = services.sign_up(soon, self.anna, now=self.now)
        code = services.format_ticket_code(row.ticket_code)

        client = APIClient()
        client.force_authenticate(self.staff)

        looked_up = client.get(f"/api/events/admin/tickets/{code}/")
        self.assertEqual(looked_up.status_code, 200)
        self.assertTrue(looked_up.json()["can_mark"])
        registration_id = looked_up.json()["registration_id"]

        attempts = [
            client.post(
                f"/api/events/admin/registrations/{registration_id}/attendance/",
                {"attendance": EventRegistration.ATTENDANCE_ATTENDED},
                format="json",
            )
            for _ in range(2)
        ]

        self.assertEqual([r.status_code for r in attempts], [200, 200])
        self.assertEqual(
            PointAward.objects.filter(
                idempotency_key=RC.event_attendance_key(registration_id)
            ).count(),
            1,
        )
