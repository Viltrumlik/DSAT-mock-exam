"""What a post says: the Uzbek frame, the admin's words escaped, and the length cut."""

from __future__ import annotations

import re

from django.test import SimpleTestCase, TestCase, override_settings

from events.models import Event, EventRegistration
from telegram_posts import render
from telegram_posts import texts as T
from telegram_posts.models import GroupPost
from telegram_posts.testkit import at, make_event
from users.models import User


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
