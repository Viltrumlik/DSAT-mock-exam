"""The two tables' own guarantees: one delivery per post, day and chat; one post per event and kind."""

from __future__ import annotations

from datetime import date, timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from events.models import Event
from telegram_posts.models import GroupPost, GroupPostDelivery


def _event():
    now = timezone.now()
    return Event.objects.create(
        title="Admission Workshop", starts_at=now + timedelta(days=3),
        ends_at=now + timedelta(days=3, hours=2), seats=30,
    )


class ModelTests(TestCase):
    def test_the_flag_defaults_to_off(self):
        self.assertFalse(settings.TELEGRAM_GROUP_POSTS_ENABLED)

    def test_one_delivery_per_post_day_and_chat(self):
        post = GroupPost.objects.create(text="Ertaga mock!")
        GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001")
        with self.assertRaises(IntegrityError), transaction.atomic():
            GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001")
        # The next week is a run of its own.
        GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 31), chat_id="-1001")

    def test_one_post_per_event_and_kind(self):
        event = _event()
        GroupPost.objects.create(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=event)
        GroupPost.objects.create(
            kind=GroupPost.KIND_EVENT_REMINDER, event=event, when=GroupPost.WHEN_EVENT
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            GroupPost.objects.create(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=event)

    def test_manual_posts_are_not_limited(self):
        GroupPost.objects.create(text="a")
        GroupPost.objects.create(text="b")
        self.assertEqual(GroupPost.objects.count(), 2)

    def test_defaults(self):
        before = timezone.now()
        post = GroupPost.objects.create(text="a")
        self.assertGreaterEqual(post.active_from, before)
        self.assertEqual((post.kind, post.when), (GroupPost.KIND_MANUAL, GroupPost.WHEN_NOW))
        self.assertEqual((post.subjects, post.levels, post.classroom_ids, post.weekdays), ([], [], [], []))
        self.assertFalse(post.is_event_post)
        self.assertTrue(GroupPost(kind=GroupPost.KIND_EVENT_REMINDER).is_event_post)
