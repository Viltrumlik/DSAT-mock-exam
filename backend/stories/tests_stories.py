"""Stories: what is on the rail, and who is allowed to put it there.

The largest block here is the publish window, because that is the only part of this feature
with a rule in it. `is_active` is a tickbox and ordering is a sort; the window is four
combinations of two nullable columns, and getting one of them backwards means a notice for
next Friday goes up today, or the one that is up today never appears at all.

The rest is the access boundary: a story is school-wide, so a teacher posting one would be
publishing to every student in the building.
"""

from __future__ import annotations

import base64
import tempfile
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from stories.models import Story

User = get_user_model()

#: The smallest thing Pillow will accept as an image — a 1×1 transparent PNG. The upload test
#: needs a *real* image because `ImageField` validates it; the bytes themselves never matter.
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def _u(email, **kw):
    return User.objects.create_user(email, "secret123", **kw)


class StoryFixture(TestCase):
    def setUp(self):
        self.staff = _u("st_admin@t.com", role=C.ROLE_ADMIN)
        self.teacher = _u("st_teacher@t.com", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH)
        self.student = _u("st_student@t.com")
        self.client = APIClient()
        self.now = timezone.now()

    def _story(self, title, **kw):
        return Story.objects.create(title=title, **kw)

    def _rail(self, as_user=None):
        self.client.force_authenticate(as_user or self.student)
        return self.client.get("/api/stories/").json()["stories"]


class LiveWindowTests(StoryFixture):
    """`Story.objects.live()` is the only place the window is expressed — so it is the only
    place it is tested, and every view test below leans on these cases."""

    def test_a_story_with_no_window_at_all_is_showing(self):
        """The ordinary case: an administrator uploads a flyer and it is up."""
        self._story("Always on")

        self.assertEqual([s["title"] for s in self._rail()], ["Always on"])

    def test_an_inactive_story_is_hidden_however_open_its_window(self):
        self._story(
            "Taken down",
            is_active=False,
            starts_at=self.now - timedelta(days=1),
            ends_at=self.now + timedelta(days=1),
        )

        self.assertEqual(self._rail(), [])

    def test_a_story_scheduled_for_later_is_not_up_yet(self):
        self._story("Next Friday's mock", starts_at=self.now + timedelta(hours=2))

        self.assertEqual(self._rail(), [])

    def test_a_story_whose_end_has_passed_falls_off_by_itself(self):
        """Nobody has to remember to untick it — that is the point of `ends_at`."""
        self._story("Last term's notice", ends_at=self.now - timedelta(minutes=1))

        self.assertEqual(self._rail(), [])

    def test_an_open_ended_run_that_has_already_started_is_showing(self):
        """Null `ends_at` means never expires, not "expired at null"."""
        self._story("Running since Monday", starts_at=self.now - timedelta(days=3))

        self.assertEqual([s["title"] for s in self._rail()], ["Running since Monday"])

    def test_live_takes_the_moment_it_is_asked_about(self):
        """The window is evaluated against a `now` the caller can supply, so a scheduled
        story can be reasoned about without waiting for the clock."""
        story = self._story("Opens in an hour", starts_at=self.now + timedelta(hours=1))

        self.assertFalse(Story.objects.live(self.now).filter(pk=story.pk).exists())
        self.assertTrue(
            Story.objects.live(self.now + timedelta(hours=2)).filter(pk=story.pk).exists()
        )


class RailTests(StoryFixture):
    def test_the_rail_is_ordered_by_sort_order_then_newest(self):
        self._story("Third", sort_order=5)
        self._story("First", sort_order=1)
        self._story("Second", sort_order=1)   # same slot, posted later → ahead of "First"

        self.assertEqual([s["title"] for s in self._rail()], ["Second", "First", "Third"])

    def test_a_story_with_no_image_reports_none_rather_than_exploding(self):
        """`.url` on an unset FileField raises; unguarded that is a 500 on the whole rail
        for one administrator who saved a story before uploading its picture."""
        self._story("No picture yet")

        self.assertIsNone(self._rail()[0]["image_url"])

    def test_the_rail_needs_a_signed_in_user(self):
        self.assertEqual(self.client.get("/api/stories/").status_code, 401)

    def test_a_student_sees_the_caption_and_link_they_will_tap(self):
        self._story("Open day", caption="Saturday, 10am", link_url="https://example.com/openday")

        row = self._rail()[0]

        self.assertEqual(row["caption"], "Saturday, 10am")
        self.assertEqual(row["link_url"], "https://example.com/openday")


class AdminAccessTests(StoryFixture):
    def test_a_student_cannot_post_a_story(self):
        self.client.force_authenticate(self.student)

        self.assertEqual(self.client.get("/api/stories/admin/stories/").status_code, 403)
        self.assertEqual(
            self.client.post("/api/stories/admin/stories/", {"title": "Mine"}, format="json").status_code,
            403,
        )

    def test_a_teacher_cannot_post_a_story_either(self):
        """A story is school-wide; a classroom teacher publishing to the whole building is
        not a decision the classroom owns."""
        self.client.force_authenticate(self.teacher)

        self.assertEqual(self.client.get("/api/stories/admin/stories/").status_code, 403)

    def test_a_student_cannot_edit_or_delete_one(self):
        story = self._story("Not yours")
        self.client.force_authenticate(self.student)

        self.assertEqual(
            self.client.patch(
                f"/api/stories/admin/stories/{story.pk}/", {"title": "Hacked"}, format="json"
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.delete(f"/api/stories/admin/stories/{story.pk}/").status_code, 403
        )
        self.assertTrue(Story.objects.filter(pk=story.pk).exists())


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class AdminCrudTests(StoryFixture):
    """Uploads land in a throwaway MEDIA_ROOT — the real one is a working directory in the
    repo, and a test suite must not leave 1×1 PNGs in it."""

    def _image(self):
        return SimpleUploadedFile("story.png", PNG_1PX, content_type="image/png")

    def test_an_admin_can_post_a_story_with_an_image(self):
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            "/api/stories/admin/stories/",
            {"title": "Open day", "caption": "Saturday", "image": self._image()},
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["title"], "Open day")
        self.assertIsNotNone(response.json()["image_url"])
        self.assertEqual(Story.objects.get().created_by, self.staff)

    def test_a_story_without_an_image_is_refused(self):
        """The picture *is* the story; without one the dashboard shows an empty circle."""
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            "/api/stories/admin/stories/", {"title": "Words only"}, format="multipart"
        )

        self.assertEqual(response.status_code, 400)

    def test_a_window_that_closes_before_it_opens_is_refused(self):
        """Saved, it would simply never appear — which reads as a broken rail, not a typo."""
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            "/api/stories/admin/stories/",
            {
                "title": "Impossible",
                "image": self._image(),
                "starts_at": (self.now + timedelta(days=2)).isoformat(),
                "ends_at": (self.now + timedelta(days=1)).isoformat(),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("ends_at", response.json())

    def test_the_console_lists_hidden_and_expired_stories_and_says_which_are_up(self):
        """The rail hides them; the desk that posted them has to still see them."""
        self._story("Up now")
        self._story("Pulled", is_active=False)
        self._story("Over", ends_at=self.now - timedelta(minutes=1))
        self.client.force_authenticate(self.staff)

        rows = self.client.get("/api/stories/admin/stories/").json()["stories"]

        self.assertEqual({r["title"] for r in rows}, {"Up now", "Pulled", "Over"})
        self.assertEqual({r["title"] for r in rows if r["is_live"]}, {"Up now"})

    def test_editing_a_title_does_not_demand_the_image_again(self):
        story = self._story("Typo")
        self.client.force_authenticate(self.staff)

        response = self.client.patch(
            f"/api/stories/admin/stories/{story.pk}/", {"title": "Fixed"}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "Fixed")

    def test_pulling_a_story_down_comes_back_saying_it_is_down(self):
        """`is_live` is answered from a set built before the edit unless the view re-reads —
        an admin who just unticked Is active must not be told it is still up."""
        story = self._story("Mistake")
        self.client.force_authenticate(self.staff)

        body = self.client.patch(
            f"/api/stories/admin/stories/{story.pk}/", {"is_active": False}, format="json"
        ).json()

        self.assertFalse(body["is_active"])
        self.assertFalse(body["is_live"])
        self.assertEqual(self._rail(), [])

    def test_an_admin_can_delete_a_story_outright(self):
        """Unlike a shop item, nothing points at a story — there is no seen state to orphan."""
        story = self._story("Gone")
        self.client.force_authenticate(self.staff)

        response = self.client.delete(f"/api/stories/admin/stories/{story.pk}/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["deleted"])
        self.assertFalse(Story.objects.filter(pk=story.pk).exists())
