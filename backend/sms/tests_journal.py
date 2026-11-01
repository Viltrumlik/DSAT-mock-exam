"""The journal's filters (operator, group, teacher, template, campaign, from–to) and its richer rows."""

from __future__ import annotations

from datetime import datetime
from datetime import timezone as dt_timezone

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from classes.models import Classroom, ClassroomMembership
from sms.models import SmsCampaign, SmsMessage
from sms.tests_api import ApiFixture

S = SmsMessage


class JournalFilterTests(ApiFixture):
    def setUp(self):
        super().setUp()
        self.room.teacher = self.teacher
        self.room.save(update_fields=["teacher"])
        self.room2 = self.classroom("Senior S1 | English")
        ClassroomMembership.objects.create(classroom=self.room2, user=self.malika, role=ClassroomMembership.ROLE_STUDENT)
        self.aziz = self.learner(102, "aziz", balance=0, phone="998991112233", room=self.room2)
        gone = self.classroom("Old one")
        ClassroomMembership.objects.create(
            classroom=gone, user=self.aziz, role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_REMOVED,
        )
        self.campaign = SmsCampaign.objects.create(
            template_eskiz_id=70000, pattern="p", slot_roles=[], slot_texts=[], audience=SmsCampaign.AUDIENCE_DEBTORS,
            audience_ids=[], scheduled_at=timezone.now(),
        )
        self.m1 = self.sms("d1", self.malika, "998901234567", kind=S.KIND_DEBT_WARNING, template=64942,
                           status=S.STATUS_DELIVERED, at=datetime(2026, 10, 31, 19, 30, tzinfo=dt_timezone.utc))
        self.m2 = self.sms("c1", self.aziz, "998991112233", kind=S.KIND_CAMPAIGN, template=70000, campaign=self.campaign,
                           at=datetime(2026, 11, 2, 8, 0, tzinfo=dt_timezone.utc))
        self.m3 = self.sms("t1", None, "998331234567", kind=S.KIND_TEST, at=datetime(2026, 11, 3, 8, 0, tzinfo=dt_timezone.utc))

    def classroom(self, name):
        return Classroom.objects.create(
            name=name, subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )

    def sms(self, key, user, phone, *, kind, template=None, campaign=None, status=S.STATUS_SENT, at):
        row = S.objects.create(
            kind=kind, run_on=at.date(), dedupe_key=key, phone=phone, text="x", user=user, status=status,
            template_eskiz_id=template, campaign=campaign, parts=1, unit_price=170,
        )
        S.objects.filter(pk=row.pk).update(created_at=at)
        return row

    def ids(self, **params):
        return [r["id"] for r in self.get("messages/", **params).json()["results"]]

    def options(self, key, **params):
        data = self.get("messages/", **params).json()
        facet = next(f for f in data["filters"] if f["key"] == key)
        return {o["label"]: o["count"] for o in facet["options"]}

    def test_the_filters_in_order(self):
        keys = [f["key"] for f in self.get("messages/").json()["filters"]]
        self.assertEqual(keys, ["kind", "status", "when", "operator", "group", "teacher", "template", "campaign"])

    def test_operator(self):
        self.assertEqual(self.ids(operator="Uzmobile"), [self.m2.pk])
        self.assertEqual(self.options("operator"), {"Beeline": 1, "Uzmobile": 1, "Humans": 1})
        self.assertEqual(len(self.ids(operator="Nokia")), 3)

    def test_group_lists_a_row_once_and_counts_current_active_seats(self):
        self.assertEqual(self.ids(group=self.room2.pk), [self.m2.pk, self.m1.pk])
        self.assertEqual(self.ids(group=self.room.pk), [self.m1.pk])
        self.assertEqual(self.options("group"), {"Junior G21 | Math": 1, "Senior S1 | English": 2})

    def test_teacher(self):
        self.assertEqual(self.ids(teacher=self.teacher.pk), [self.m1.pk])
        self.assertEqual(self.options("teacher"), {"t": 1})

    def test_template_and_campaign(self):
        self.assertEqual(self.ids(template=64942), [self.m1.pk])
        self.assertEqual(self.options("template"), {"#64942": 1, "#70000": 1})
        self.assertEqual(self.ids(campaign=self.campaign.pk), [self.m2.pk])
        self.assertEqual(self.options("campaign"), {f"#{self.campaign.pk} · Debtors": 1})

    def test_from_to_are_inclusive_tashkent_days(self):
        self.assertEqual(self.ids(**{"from": "2026-11-01", "to": "2026-11-01"}), [self.m1.pk])
        self.assertEqual(self.ids(**{"from": "2026-11-02"}), [self.m3.pk, self.m2.pk])
        self.assertEqual(self.ids(to="2026-10-31"), [])
        self.assertEqual(len(self.ids(**{"from": "yesterday"})), 3)

    def test_the_rows_new_fields(self):
        rows = {r["id"]: r for r in self.get("messages/").json()["results"]}
        m1, m2, m3 = rows[self.m1.pk], rows[self.m2.pk], rows[self.m3.pk]
        self.assertEqual(m1["operator"], "Beeline")
        self.assertEqual(m1["groups"], ["Junior G21 | Math", "Senior S1 | English"])
        self.assertEqual(m1["source"], {"type": "debt_warning", "id": None, "label": "Debt warning"})
        self.assertEqual(m1["template"], {"id": 64942, "label": "#64942"})
        self.assertEqual(m1["cost"], 170)
        self.assertIn("checked_at", m1)
        self.assertEqual(m2["groups"], ["Senior S1 | English"])
        self.assertEqual(m2["source"], {"type": "campaign", "id": self.campaign.pk, "label": f"Campaign #{self.campaign.pk} · Debtors"})
        self.assertEqual(m3["source"], {"type": "test", "id": None, "label": "Test"})
        self.assertEqual(m3["template"], {"id": None, "label": ""})
        self.assertEqual(m3["groups"], [])

    def count_queries(self):
        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(self.get("messages/").status_code, 200)
        return len(ctx.captured_queries)

    def test_the_query_count_does_not_grow_with_classes(self):
        few = self.count_queries()
        for i in range(27):
            room = self.classroom(f"Extra {i}")
            ClassroomMembership.objects.create(classroom=room, user=self.malika, role=ClassroomMembership.ROLE_STUDENT)
            self.sms(f"x{i}", self.malika, "998901234567", kind=S.KIND_TEST, at=datetime(2026, 11, 3, 9, i, tzinfo=dt_timezone.utc))
        self.assertEqual(self.count_queries(), few)
