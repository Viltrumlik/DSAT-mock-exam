"""What a post says: the Uzbek frame, the admin's words escaped, and the length cut."""

from __future__ import annotations

import html
import re
from unittest import mock

from django.test import SimpleTestCase, TestCase, override_settings

from events.models import Event, EventRegistration
from telegram_posts import render
from telegram_posts import texts as T
from telegram_posts.models import GroupPost
from telegram_posts.testkit import at, make_event
from users.models import User


def telegram_units(markup: str) -> int:
    """Telegram's count, worked out here independently of `render.visible_len`."""
    plain = html.unescape(re.sub(r"<[^>]+>", "", markup))
    return len(plain.encode("utf-16-le")) // 2


class WhenTests(SimpleTestCase):
    def test_same_day(self):
        self.assertEqual(
            render.when_uz(at(2026, 10, 25, 12, 30), at(2026, 10, 25, 14, 0)),
            "Yakshanba, 25-oktabr, 12:30–14:00",
        )

    def test_start_only(self):
        self.assertEqual(render.when_uz(at(2026, 10, 24, 18, 0)), "Shanba, 24-oktabr, 18:00")

    def test_across_days(self):
        self.assertEqual(
            render.when_uz(at(2026, 10, 24, 18, 0), at(2026, 10, 25, 10, 0)),
            "Shanba, 24-oktabr, 18:00 – 25-oktabr, 10:00",
        )


@override_settings(EMAIL_SITE_URL="https://mastersat.uz")
class EventTextTests(TestCase):
    def setUp(self):
        # A reminder reads the clock. Pin it to the evening before make_event's 25 Oct start,
        # so the reminder tests keep their meaning when the calendar passes that date.
        clock = mock.patch("django.utils.timezone.now", return_value=at(2026, 10, 24, 18, 0))
        clock.start()
        self.addCleanup(clock.stop)

    def test_the_announcement_lines(self):
        event = make_event(title="Admission <Workshop> & Q&A", description="Bring your questions.")
        result = render.event_announcement(event)
        self.assertEqual(
            result.text,
            "📢 <b>Admission &lt;Workshop&gt; &amp; Q&amp;A</b>\n\n"
            "🗓 Yakshanba, 25-oktabr, 12:30–14:00\n"
            "📍 MasterSAT, Room 2\n"
            "👥 30 ta joy\n\n"
            "Bring your questions.",
        )
        self.assertEqual(result.button, ("📝 Ro'yxatdan o'tish", "https://mastersat.uz/events"))
        self.assertIsNone(result.image)

    def test_no_place_no_place_line(self):
        self.assertNotIn("📍", render.event_announcement(make_event(location="")).text)

    def test_a_long_description_is_cut_to_the_caption_limit_with_a_picture(self):
        event = make_event(description="x" * 3000)
        event.cover_image = "events/cover.png"  # a name is enough: nothing is read here
        result = render.event_announcement(event)
        self.assertEqual(result.image.name, "events/cover.png")
        self.assertLessEqual(render.visible_len(result.text), render.CAPTION_MAX)
        self.assertTrue(result.text.endswith(T.MORE_ON_SITE))

    def test_without_a_picture_the_limit_is_4096(self):
        self.assertNotIn(T.MORE_ON_SITE, render.event_announcement(make_event(description="x" * 3000)).text)
        long = render.event_announcement(make_event(description="x" * 5000)).text
        self.assertLessEqual(render.visible_len(long), render.TEXT_MAX)
        self.assertTrue(long.endswith(T.MORE_ON_SITE))

    def test_a_cut_never_splits_an_escape(self):
        event = make_event(description="&" * 3000)
        event.cover_image = "events/cover.png"
        text = render.event_announcement(event).text
        self.assertIsNone(re.search(r"&(?!amp;|lt;|gt;)", text))

    def test_the_reminder_with_seats_left(self):
        result = render.event_reminder(make_event(seats=10))
        self.assertTrue(result.text.startswith("⏰ <b>Ertaga: Admission Workshop</b>\n\n🗓 Yakshanba, 25-oktabr"))
        self.assertIn(T.SEATS_LEFT.format(n=10), result.text)
        self.assertIsNotNone(result.button)

    def test_the_reminder_when_full_has_no_button(self):
        event = make_event(seats=1)
        EventRegistration.objects.create(event=event, student=User.objects.create_user("rs@t.com", "x"))
        result = render.event_reminder(event)
        self.assertIn(T.SEATS_FULL, result.text)
        self.assertIsNone(result.button)

    def test_no_reminder_for_a_cancelled_event(self):
        self.assertIsNone(render.event_reminder(make_event(status=Event.STATUS_CANCELLED)))

    def test_render_picks_by_kind(self):
        event = make_event()
        self.assertTrue(render.render(GroupPost(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=event)).text.startswith("📢"))
        self.assertTrue(render.render(GroupPost(kind=GroupPost.KIND_EVENT_REMINDER, event=event)).text.startswith("⏰"))
        event.status = Event.STATUS_CANCELLED
        self.assertIsNone(render.render(GroupPost(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=event)))

    def test_no_reminder_once_the_event_has_started(self):
        event = make_event()  # starts 25 Oct at 12:30
        with mock.patch("django.utils.timezone.now", return_value=at(2026, 10, 25, 12, 29)):
            self.assertIsNotNone(render.event_reminder(event))
        with mock.patch("django.utils.timezone.now", return_value=at(2026, 10, 25, 12, 30)):
            self.assertIsNone(render.event_reminder(event))
            self.assertIsNone(render.render(GroupPost(kind=GroupPost.KIND_EVENT_REMINDER, event=event)))

    def test_the_reminder_says_ertaga_only_on_the_evening_before(self):
        event = make_event()  # starts Sunday 25 Oct, 12:30
        with mock.patch("django.utils.timezone.now", return_value=at(2026, 10, 24, 18, 0)):
            self.assertTrue(render.event_reminder(event).text.startswith("⏰ <b>Ertaga: Admission Workshop</b>"))
        with mock.patch("django.utils.timezone.now", return_value=at(2026, 10, 24, 23, 59)):  # still tomorrow
            self.assertTrue(render.event_reminder(event).text.startswith("⏰ <b>Ertaga:"))

    def test_a_reminder_that_goes_out_on_the_day_says_bugun(self):
        # A retry, or "Send missed now", the next morning: "tomorrow" would be untrue.
        event = make_event()
        with mock.patch("django.utils.timezone.now", return_value=at(2026, 10, 25, 8, 0)):
            result = render.event_reminder(event)
            self.assertTrue(result.text.startswith("⏰ <b>Bugun: Admission Workshop</b>\n\n🗓 Yakshanba, 25-oktabr"))
            self.assertNotIn("Ertaga", result.text)
            self.assertEqual(render.render(GroupPost(kind=GroupPost.KIND_EVENT_REMINDER, event=event)).text, result.text)

    def test_no_reminder_two_days_before_the_event(self):
        event = make_event()
        with mock.patch("django.utils.timezone.now", return_value=at(2026, 10, 23, 20, 0)):
            self.assertIsNone(render.event_reminder(event))
            self.assertIsNone(render.render(GroupPost(kind=GroupPost.KIND_EVENT_REMINDER, event=event)))

    def test_the_day_is_the_tashkent_day_not_the_utc_one(self):
        # 25 Oct 00:30 Tashkent is still 24 Oct in UTC: the event, 25 Oct 12:30, is "today" for the reader.
        event = make_event()
        with mock.patch("django.utils.timezone.now", return_value=at(2026, 10, 25, 0, 30)):
            self.assertTrue(render.event_reminder(event).text.startswith("⏰ <b>Bugun:"))

    def test_the_console_preview_shows_the_reminder_as_it_will_go_out_even_days_ahead(self):
        event = make_event()
        with mock.patch("django.utils.timezone.now", return_value=at(2026, 10, 20, 10, 0)):
            self.assertIsNone(render.render(GroupPost(kind=GroupPost.KIND_EVENT_REMINDER, event=event)))
            preview = render.render(GroupPost(kind=GroupPost.KIND_EVENT_REMINDER, event=event), preview=True)
        self.assertTrue(preview.text.startswith("⏰ <b>Ertaga: Admission Workshop</b>"))

    def test_the_announcement_is_not_rendered_once_its_event_has_started(self):
        event = make_event()  # starts 25 Oct 12:30
        post = GroupPost(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=event)
        with mock.patch("django.utils.timezone.now", return_value=at(2026, 10, 25, 12, 29)):
            self.assertIsNotNone(render.render(post))
        with mock.patch("django.utils.timezone.now", return_value=at(2026, 10, 25, 12, 30)):
            self.assertIsNone(render.render(post))  # a retry can never post a sign-up button now
            self.assertTrue(render.render(post, preview=True).text.startswith("📢"))  # the console still shows it

    def test_a_cut_fills_the_text_limit_exactly(self):
        text = render.event_announcement(make_event(description="x" * 5000)).text
        self.assertEqual(render.visible_len(text), render.TEXT_MAX)
        self.assertTrue(text.endswith(T.MORE_ON_SITE))

    def test_emoji_count_two_units_against_the_caption_limit(self):
        event = make_event(description="😀" * 900)
        event.cover_image = "events/cover.png"
        text = render.event_announcement(event).text
        self.assertLessEqual(telegram_units(text), render.CAPTION_MAX)
        self.assertTrue(text.endswith(T.MORE_ON_SITE))
        self.assertGreaterEqual(telegram_units(text), render.CAPTION_MAX - 1)  # the room is used


class ManualTextTests(SimpleTestCase):
    def test_text_is_escaped(self):
        self.assertEqual(
            render.manual(GroupPost(text="  Mock <ertaga> & keling  ")).text,
            "Mock &lt;ertaga&gt; &amp; keling",
        )

    def test_the_button_needs_both_halves(self):
        self.assertIsNone(render.manual(GroupPost(text="a", button_text="Ro'yxat", button_url="")).button)
        self.assertEqual(
            render.manual(GroupPost(text="a", button_text="Go", button_url="https://t.me/x")).button,
            ("Go", "https://t.me/x"),
        )

    def test_a_picture_post_obeys_the_caption_limit(self):
        post = GroupPost(text="y" * 2000)
        post.image = "telegram_posts/p.png"
        self.assertLessEqual(render.visible_len(render.manual(post).text), render.CAPTION_MAX)

    def test_an_over_limit_picture_post_ends_with_a_bare_ellipsis(self):
        post = GroupPost(text="y" * 2000)
        post.image = "telegram_posts/p.png"
        text = render.manual(post).text
        self.assertTrue(text.endswith("…"))
        self.assertNotIn(T.MORE_ON_SITE, text)  # the site has no copy of an admin's post
        self.assertLessEqual(render.visible_len(text), render.CAPTION_MAX)

    def test_a_cut_fills_the_text_limit_exactly(self):
        text = render.manual(GroupPost(text="x" * 5000)).text
        self.assertEqual(render.visible_len(text), render.TEXT_MAX)
        self.assertTrue(text.endswith("…"))


class TgLenTests(SimpleTestCase):
    def test_telegram_counts_utf16_units(self):
        self.assertEqual(render.tg_len("a"), 1)
        self.assertEqual(render.tg_len("📢"), 2)
        self.assertEqual(render.visible_len("<b>📢</b> &amp;"), 4)  # 📢 is 2, the space 1, & 1
