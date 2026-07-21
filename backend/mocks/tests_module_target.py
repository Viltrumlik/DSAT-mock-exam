"""Regression: a stale/retried submit must not finalize the NEXT mock section.

Same class of bug confirmed on prod for pastpapers (Module 2 skipped, ~24% of attempts):
the client retries a timed-out submit with a new idempotency key; the first request
advances the module, the retry lands on the now-active next module and finalizes it with
the previous module's answers. The full mock has FOUR boundaries (E1->E2->BREAK->M1->M2),
so the same retry would skip a whole section. Fix: submit is module-targeted — the client
sends module_id and the server no-ops if that module is no longer active.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from mocks.models import MockAttempt
from mocks.tests_scoring import make_mock

User = get_user_model()


class MockSubmitModuleTargetTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="mt", email="mt@x.io")
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        self.mock, (self.e1, self.e2, self.m1, self.m2) = make_mock()

    def _start(self):
        r = self.c.post("/api/mocks/attempts/", {"mock": self.mock.id}, format="json")
        aid = r.json()["id"]
        self.c.post(f"/api/mocks/attempts/{aid}/start/", {}, format="json")
        return aid

    def _submit(self, aid, module_id=None, answers=None):
        body = {"answers": answers or {}}
        if module_id is not None:
            body["module_id"] = module_id
        return self.c.post(f"/api/mocks/attempts/{aid}/submit_module/", body, format="json")

    def test_stale_e1_submit_does_not_finalize_e2(self):
        aid = self._start()
        # First submit (targets English M1) advances to English M2.
        r1 = self._submit(aid, module_id=self.e1.id)
        self.assertEqual(r1.status_code, 200, r1.content)
        self.assertEqual(r1.json()["current_state"], "MODULE_2_ACTIVE")

        # Stale/retried submit STILL targeting E1 — must be a no-op, NOT finalize E2.
        r2 = self._submit(aid, module_id=self.e1.id)
        self.assertEqual(r2.status_code, 200, r2.content)
        self.assertEqual(r2.json()["current_state"], "MODULE_2_ACTIVE")  # still on E2, not advanced
        att = MockAttempt.objects.get(pk=aid)
        # E2's answer slot stays untouched (would have been written with the stale payload).
        self.assertEqual(att.module_answers.get(str(self.e2.id), {}), {})

    def test_targeted_submit_of_current_module_advances(self):
        aid = self._start()
        self.assertEqual(self._submit(aid, module_id=self.e1.id).json()["current_state"], "MODULE_2_ACTIVE")
        # Targeting the CURRENT module (E2) advances normally.
        r = self._submit(aid, module_id=self.e2.id)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertNotEqual(r.json()["current_state"], "MODULE_2_ACTIVE")  # advanced past E2 (break/math)

    def test_no_module_id_is_backward_compatible(self):
        aid = self._start()
        r = self._submit(aid)  # old client: no module_id → submits current module
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["current_state"], "MODULE_2_ACTIVE")
