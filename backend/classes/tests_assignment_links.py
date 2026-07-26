"""Multiple external links on a regular classroom homework (classes.Assignment).

Create is multipart (external_urls is a JSON-encoded string, like practice_test_ids); edit
is a JSON body (external_urls is a real array). Both go through AssignmentSerializer.validate,
which keeps external_urls (the list) and external_url (mirror of the first) consistent.
"""
from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class AssignmentMultiLinkTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("al_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Links",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _collection(self):
        return f"/api/classes/{self.classroom.id}/assignments/"

    def _detail(self, aid):
        return f"/api/classes/{self.classroom.id}/assignments/{aid}/"

    def test_create_multipart_with_multiple_links(self):
        resp = self.client.post(
            self._collection(),
            {
                "title": "HW",
                "instructions": "read",
                "external_urls": json.dumps(["example.com/a", "https://b.com/x"]),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body["external_urls"], ["https://example.com/a", "https://b.com/x"])
        # Legacy mirror is the first link.
        self.assertEqual(body["external_url"], "https://example.com/a")
        a = Assignment.objects.get(pk=body["id"])
        self.assertEqual(a.external_urls, ["https://example.com/a", "https://b.com/x"])
        self.assertEqual(a.external_url, "https://example.com/a")

    def test_create_legacy_single_link(self):
        resp = self.client.post(
            self._collection(),
            {"title": "HW", "instructions": "read", "external_url": "only.com/x"},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body["external_urls"], ["https://only.com/x"])
        self.assertEqual(body["external_url"], "https://only.com/x")

    def test_edit_json_replaces_link_list(self):
        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="HW",
            external_urls=["https://old.com"], external_url="https://old.com",
        )
        resp = self.client.patch(
            self._detail(a.id),
            {"external_urls": ["new1.com", "new2.com/y"]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertEqual(a.external_urls, ["https://new1.com", "https://new2.com/y"])
        self.assertEqual(a.external_url, "https://new1.com")

    def test_edit_empty_list_clears_links(self):
        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="HW",
            external_urls=["https://old.com"], external_url="https://old.com",
        )
        resp = self.client.patch(self._detail(a.id), {"external_urls": []}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertEqual(a.external_urls, [])
        self.assertEqual(a.external_url, "")

    def test_edit_omitting_links_leaves_them(self):
        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="HW",
            external_urls=["https://keep.com"], external_url="https://keep.com",
        )
        resp = self.client.patch(self._detail(a.id), {"instructions": "x"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertEqual(a.external_urls, ["https://keep.com"])

    def test_invalid_link_rejected(self):
        resp = self.client.post(
            self._collection(),
            {"title": "HW", "external_urls": json.dumps(["ht tp://bad url"])},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
