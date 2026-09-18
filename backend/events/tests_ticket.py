"""The ticket: its code, and the lookup the door runs on."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
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

        # assertLogs both proves the failure is logged for ops and keeps its traceback out of
        # the test output.
        with patch.object(
            ticket, "_render_png_chromium", side_effect=RuntimeError("no browser")
        ), self.assertLogs("events.ticket", level="ERROR") as logs:
            data = ticket.render_png(self.row)

        self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertIn("ticket_render_failed", logs.output[0])


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


# ---------------------------------------------------------------------------------------
# Fix round 1 — the controller's render of fictional sample tickets found real bugs in the
# Pillow fallback (never wraps; its bundled font has no glyph for a dash), plus minor
# polish on the designed card. See task-1-3-report.md's "Fix round 1" section.
# ---------------------------------------------------------------------------------------


class _FakeFont:
    """A stand-in for a Pillow font: fixed width per character, so the wrap math in these
    tests is exact and independent of whatever TrueType font the host actually has."""

    def __init__(self, char_width: int = 10):
        self.char_width = char_width

    def getlength(self, text: str) -> float:
        return len(text) * self.char_width


class WrapLinesTests(SimpleTestCase):
    """`_wrap_lines`: the Pillow fallback never wrapped a long title, place or name —
    it ran off the card's right edge instead. Tested against a fake fixed-width font."""

    def setUp(self):
        from events import ticket

        self.ticket = ticket
        self.font = _FakeFont(char_width=10)  # 100px fits exactly 10 characters

    def test_a_short_text_comes_back_as_one_line(self):
        lines = self.ticket._wrap_lines("Anna Karimova", self.font, max_width=300, max_lines=3)

        self.assertEqual(lines, ["Anna Karimova"])

    def test_blank_text_returns_no_lines(self):
        self.assertEqual(self.ticket._wrap_lines("", self.font, 300, 3), [])
        self.assertEqual(self.ticket._wrap_lines(None, self.font, 300, 3), [])
        self.assertEqual(self.ticket._wrap_lines("   ", self.font, 300, 3), [])

    def test_every_returned_line_fits_the_width(self):
        text = "SAT Math strategy workshop hard linear equation traps and how to spot fast"

        lines = self.ticket._wrap_lines(text, self.font, max_width=100, max_lines=10)

        self.assertTrue(lines)
        for line in lines:
            self.assertLessEqual(self.font.getlength(line), 100)

    def test_a_single_word_wider_than_the_card_is_itself_split(self):
        word = "A" * 40  # 400px at 10px/char — far past a 100px line, and unsplittable at spaces

        lines = self.ticket._wrap_lines(word, self.font, max_width=100, max_lines=10)

        self.assertGreater(len(lines), 1)
        for line in lines:
            self.assertLessEqual(self.font.getlength(line), 100)
        self.assertEqual("".join(lines), word)

    def test_an_over_long_text_is_capped_and_the_last_line_ends_in_ellipsis(self):
        text = "one two three four five six seven eight nine ten eleven twelve"

        lines = self.ticket._wrap_lines(text, self.font, max_width=100, max_lines=2)

        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[-1].endswith("…"))
        for line in lines:
            self.assertLessEqual(self.font.getlength(line), 100)

    def test_a_text_that_exactly_fills_the_cap_needs_no_ellipsis(self):
        # Two words per line, exactly two lines, nothing left over to truncate.
        text = "one two three four"

        lines = self.ticket._wrap_lines(text, self.font, max_width=100, max_lines=2)

        self.assertEqual(lines, ["one two", "three four"])


class NormalizeForDrawingTests(SimpleTestCase):
    """`_normalize_for_drawing`: Pillow's bundled default font has no glyph for an en/em
    dash or a curly quote, so it maps them to ASCII — but only when no real TrueType font
    was found (a real one already covers these)."""

    def test_maps_dashes_and_curly_quotes_when_no_ttf_is_installed(self):
        from unittest.mock import patch

        from events import ticket

        with patch.object(ticket, "_fallback_font_path", return_value=None):
            out = ticket._normalize_for_drawing("15:00–17:00 “hall” ‘A’ — wing")

        self.assertTrue(out.isascii())
        self.assertEqual(
            out, "15:00-17:00 \"hall\" 'A' - wing",
        )

    def test_leaves_text_untouched_when_a_real_font_was_found(self):
        from unittest.mock import patch

        from events import ticket

        with patch.object(ticket, "_fallback_font_path", return_value="/some/font.ttf"):
            out = ticket._normalize_for_drawing("15:00–17:00")

        self.assertEqual(out, "15:00–17:00")

    def test_our_own_ellipsis_is_mapped_too(self):
        from unittest.mock import patch

        from events import ticket

        with patch.object(ticket, "_fallback_font_path", return_value=None):
            out = ticket._normalize_for_drawing("spot them…")

        self.assertEqual(out, "spot them...")


class FallbackTimeRangeTests(SimpleTestCase):
    def test_it_is_plain_ascii_with_a_hyphen(self):
        from events import ticket

        text = ticket._fallback_time_range({"start_time": "15:00", "end_time": "17:00"})

        self.assertEqual(text, "15:00 - 17:00")
        self.assertTrue(text.isascii())


class ResolveFontUrlsGzipTests(SimpleTestCase):
    """`_resolve_font_urls`'s gzip branch was untested: none of the certificate template's
    own font entries are actually compressed, so nothing else ever reached it."""

    def test_a_compressed_manifest_entry_decodes_back_to_the_original_bytes(self):
        import base64
        import gzip
        import re

        from events import ticket

        original = b"\x00\x01fake-woff2-bytes\xffthe end"
        uuid = "deadbeef-0000-0000-0000-000000000000"
        manifest = {
            uuid: {
                "mime": "font/woff2",
                "compressed": True,
                "data": base64.b64encode(gzip.compress(original)).decode("ascii"),
            }
        }
        block = f'@font-face {{ src: url("{uuid}") format(\'woff2\'); }}'

        resolved = ticket._resolve_font_urls(block, manifest)

        match = re.search(r"url\(data:font/woff2;base64,([^)]+)\)", resolved)
        self.assertIsNotNone(match)
        self.assertEqual(base64.b64decode(match.group(1)), original)


class TicketAssetAndLayoutTests(TicketFixture):
    """The designed card: a legible logo on the band, and room to grow rather than clip."""

    def test_the_band_logo_is_the_white_shield_not_the_navy_one(self):
        from events import ticket

        context = ticket.build_context(self.row)

        # Navy-on-blue was nearly invisible on the band; white reads clearly there.
        self.assertEqual(context["logo"], ticket._data_uri("shield_white.png"))
        self.assertNotEqual(context["logo"], ticket._data_uri("shield_navy.png"))

    def test_the_card_can_grow_rather_than_clip_a_long_ticket(self):
        from events import ticket

        html = ticket.render_html(self.row)

        self.assertIn("min-height", html)

    def test_the_qr_is_bigger_with_room_around_the_code(self):
        from events import ticket

        html = ticket.render_html(self.row)

        self.assertIn("300px", html)
        self.assertIn("gap: 32px", html)


class LongContentFallbackTests(SimpleTestCase):
    """The exact shape of data that exposed the wrap and glyph bugs (the controller's own
    render_samples.py). Unsaved model instances are enough — `render_png_fallback` never
    touches the database, only attributes already set on what it is handed."""

    def test_a_long_title_place_and_name_render_without_crashing(self):
        from events import ticket

        now = timezone.now()
        event = Event(
            id=1,
            title=(
                "SAT Math strategy workshop: hard linear-equation traps and how to spot "
                "them fast"
            ),
            location=(
                "Tashkent, Chilonzor branch — 2nd floor, main hall (entrance from "
                "the courtyard)"
            ),
            seats=30,
            status=Event.STATUS_PUBLISHED,
            starts_at=now + timedelta(days=7),
            ends_at=now + timedelta(days=7, hours=2),
        )
        student = User(
            email="long@example.com", first_name="Muhammadali",
            last_name="Abdurakhmonov-Tursunboyev",
        )
        row = EventRegistration(
            id=1, event=event, student=student,
            status=EventRegistration.STATUS_REGISTERED, ticket_code="4K297XPD",
        )

        data = ticket.render_png_fallback(row)

        self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertGreater(len(data), 2000)
