"""Multiple external links on a homework brief and classwork new-topic block.

Covers the shared normalization (classes.link_utils), the journal lesson/classwork PATCH
endpoints, the mirror invariant (external_url == external_urls[0]), and that release copies
the whole list onto the delivered classes.Assignment.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from journals import services
from journals.models import JournalClasswork, JournalLesson

User = get_user_model()


def _admin(email="j_links@test.com"):
    return User.objects.create_user(
        email=email, password="x", role=acc_const.ROLE_SUPER_ADMIN
    )


class LinkUtilsTests(TestCase):
    def test_json_string_list_is_parsed_and_normalized(self):
        from classes.link_utils import clean_external_urls

        got = clean_external_urls('["example.com/a", "https://b.com/x?y=1,2"]')
        self.assertEqual(got, ["https://example.com/a", "https://b.com/x?y=1,2"])

    def test_real_list_dedupes_preserving_order(self):
        from classes.link_utils import clean_external_urls

        got = clean_external_urls(["http://c.com", "  ", "http://c.com", "d.com"])
        self.assertEqual(got, ["http://c.com", "https://d.com"])

    def test_single_legacy_string(self):
        from classes.link_utils import clean_external_urls

        self.assertEqual(clean_external_urls("example.org/f.pdf"), ["https://example.org/f.pdf"])

    def test_none_and_blank(self):
        from classes.link_utils import clean_external_urls, first_url

        self.assertEqual(clean_external_urls(None), [])
        self.assertEqual(clean_external_urls(""), [])
        self.assertEqual(first_url([]), "")

    def test_invalid_link_raises(self):
        from django.core.exceptions import ValidationError
        from classes.link_utils import clean_external_urls

        with self.assertRaises(ValidationError):
            clean_external_urls(["not a url with spaces"])

    def test_resolve_prefers_list_over_single(self):
        from classes.link_utils import resolve_links

        self.assertEqual(
            resolve_links({"external_urls": '["a.com"]', "external_url": "b.com"}),
            (["https://a.com"], "https://a.com", [""]),
        )
        self.assertEqual(
            resolve_links({"external_url": "b.com"}),
            (["https://b.com"], "https://b.com", [""]),
        )
        self.assertIsNone(resolve_links({"title": "x"}))


class LinkNameTests(TestCase):
    """A link may carry a NAME. The names ride in a parallel, index-aligned list."""

    def test_names_arrive_alongside_the_links(self):
        from classes.link_utils import clean_link_pairs

        self.assertEqual(
            clean_link_pairs(["youtube.com", "b.com"], ["Youtube", ""]),
            [("https://youtube.com", "Youtube"), ("https://b.com", "")],
        )

    def test_object_form_is_accepted_too(self):
        from classes.link_utils import clean_link_pairs

        self.assertEqual(
            clean_link_pairs([{"url": "youtube.com", "label": "Youtube"}]),
            [("https://youtube.com", "Youtube")],
        )

    def test_a_dropped_blank_row_does_not_shift_the_names(self):
        """The killer case for a positional list: a blank link in the middle of the form."""
        from classes.link_utils import clean_link_pairs

        self.assertEqual(
            clean_link_pairs(["a.com", "   ", "c.com"], ["A", "ignored", "C"]),
            [("https://a.com", "A"), ("https://c.com", "C")],
        )

    def test_a_dedupe_keeps_the_first_name_but_fills_a_blank_one(self):
        from classes.link_utils import clean_link_pairs

        self.assertEqual(
            clean_link_pairs(["a.com", "a.com"], ["First", "Second"]),
            [("https://a.com", "First")],
        )
        self.assertEqual(
            clean_link_pairs(["a.com", "a.com"], ["", "Second"]),
            [("https://a.com", "Second")],
        )

    def test_reading_pads_a_short_or_missing_name_list(self):
        from classes.link_utils import labels_for, link_text

        self.assertEqual(labels_for(["a", "b", "c"], ["A"]), ["A", "", ""])
        self.assertEqual(labels_for(["a"], ["A", "B", "C"]), ["A"])
        self.assertEqual(labels_for(["a"], None), [""])
        self.assertEqual(link_text("https://a.com", ""), "https://a.com")
        self.assertEqual(link_text("https://a.com", " A "), "A")

    def test_names_alone_never_wipe_the_links(self):
        """A payload with only names is not a link edit — there is nothing to align to."""
        from classes.link_utils import resolve_links

        self.assertIsNone(resolve_links({"external_url_labels": ["A"]}))

    def test_patch_saves_a_name_per_link(self):
        admin = _admin("j_linknames@test.com")
        client = APIClient()
        client.force_authenticate(admin)
        journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=admin
        )
        lesson = services.add_session(journal, actor=admin)
        resp = client.patch(
            f"/api/journals/{journal.id}/lessons/{lesson.id}/",
            {
                "instructions": "watch these",
                "external_urls": ["youtube.com", "khanacademy.org"],
                "external_url_labels": ["Youtube", ""],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        lesson.refresh_from_db()
        self.assertEqual(
            lesson.external_urls, ["https://youtube.com", "https://khanacademy.org"]
        )
        self.assertEqual(lesson.external_url_labels, ["Youtube", ""])


class LessonLinkApiTests(TestCase):
    def setUp(self):
        self.admin = _admin()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )
        self.lesson = services.add_session(self.journal, actor=self.admin)

    def _url(self):
        return f"/api/journals/{self.journal.id}/lessons/{self.lesson.id}/"

    def test_patch_saves_multiple_links_and_mirrors_first(self):
        resp = self.client.patch(
            self._url(),
            {"instructions": "read these", "external_urls": ["a.com", "https://b.com/x"]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["external_urls"], ["https://a.com", "https://b.com/x"])
        self.assertEqual(body["external_url"], "https://a.com")
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.external_urls, ["https://a.com", "https://b.com/x"])
        self.assertEqual(self.lesson.external_url, "https://a.com")

    def test_legacy_single_field_still_accepted(self):
        resp = self.client.patch(
            self._url(), {"external_url": "only.com/x"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["external_urls"], ["https://only.com/x"])

    def test_empty_list_clears_links(self):
        self.lesson.external_urls = ["https://a.com"]
        self.lesson.external_url = "https://a.com"
        self.lesson.save()
        resp = self.client.patch(self._url(), {"external_urls": []}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["external_urls"], [])
        self.assertEqual(resp.json()["external_url"], "")

    def test_omitting_links_leaves_them_untouched(self):
        self.lesson.external_urls = ["https://keep.com"]
        self.lesson.external_url = "https://keep.com"
        self.lesson.save()
        resp = self.client.patch(self._url(), {"instructions": "changed"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["external_urls"], ["https://keep.com"])

    def test_invalid_link_returns_400(self):
        resp = self.client.patch(
            self._url(), {"external_urls": ["ht tp://bad url"]}, format="json"
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json().get("code"), "invalid_link")

    def test_link_alone_counts_as_content(self):
        # A homework whose only content is a link is publishable content-wise.
        self.client.patch(
            self._url(),
            {"instructions": "go", "external_urls": ["a.com"]},
            format="json",
        )
        self.lesson.refresh_from_db()
        self.assertTrue(self.lesson.has_content)


class ClassworkLinkApiTests(TestCase):
    def setUp(self):
        self.admin = _admin("cw_links@test.com")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )
        self.lesson = services.add_session(self.journal, actor=self.admin)

    def _url(self):
        return f"/api/journals/{self.journal.id}/lessons/{self.lesson.id}/classwork/"

    def test_patch_saves_multiple_new_topic_links(self):
        resp = self.client.patch(
            self._url(),
            {
                "new_topic_title": "T",
                "new_topic_instructions": "teach",
                "new_topic_external_urls": ["slides.com/1", "video.com/2"],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(
            body["new_topic_external_urls"], ["https://slides.com/1", "https://video.com/2"]
        )
        self.assertEqual(body["new_topic_external_url"], "https://slides.com/1")
        cw = JournalClasswork.objects.get(lesson=self.lesson)
        self.assertEqual(
            cw.new_topic_external_urls, ["https://slides.com/1", "https://video.com/2"]
        )


class ReleaseCopiesLinksTests(TestCase):
    """Releasing a session's homework must carry ALL its links onto the classes.Assignment."""

    def setUp(self):
        from datetime import date
        from classes.models import Classroom
        from journals.models import Journal

        self.admin = _admin("rel_links@test.com")
        self.classroom = Classroom.objects.create(
            name="Math Middle A",
            subject=Classroom.SUBJECT_MATH,
            level=Classroom.LEVEL_MIDDLE,
            lesson_days=Classroom.DAYS_ODD,
            lesson_time="18:00",
            start_date=date(2026, 8, 3),
            created_by=self.admin,
        )
        self.journal, _ = services.create_journal(
            subject="MATH", level="middle", actor=self.admin
        )
        self.journal.status = Journal.STATUS_PUBLISHED
        self.journal.save(update_fields=["status"])
        self.lesson = services.add_session(self.journal, actor=self.admin)
        self.lesson.instructions = "do it"
        self.lesson.external_urls = ["https://a.com/1", "https://b.com/2"]
        self.lesson.external_url_labels = ["Slides", ""]
        self.lesson.external_url = "https://a.com/1"
        self.lesson.save()

    def test_release_copies_full_link_list(self):
        from journals import delivery

        row, created, _ = delivery.release_homework(
            self.classroom, self.lesson, actor=self.admin
        )
        self.assertTrue(created)
        self.assertIsNotNone(row.assignment_id)
        self.assertEqual(
            row.assignment.external_urls, ["https://a.com/1", "https://b.com/2"]
        )
        self.assertEqual(row.assignment.external_url, "https://a.com/1")

    def test_release_carries_each_links_name(self):
        """A name is part of the link. Losing it in the copy would show students a raw URL
        where their teacher wrote "Slides"."""
        from journals import delivery

        row, _created, _ = delivery.release_homework(
            self.classroom, self.lesson, actor=self.admin
        )
        self.assertEqual(row.assignment.external_url_labels, ["Slides", ""])
