"""GET /api/realtime/events/ streams only on a deployment that opted in (REALTIME_SSE_ENABLED).

Each open stream holds a sync gunicorn worker for up to REALTIME_SSE_MAX_STREAM_S, and production
runs three, so any logged-in user with three tabs (or a loop) could stop the site answering for
everyone: the mechanism of the 2026-08-23 freeze (5a6828f7). The client already opens nothing unless
NEXT_PUBLIC_REALTIME_STREAM is "1" (frontend/src/lib/realtime.ts). These pin the server's half, which
opening the URL directly does not get around.
"""

from __future__ import annotations

import os
from unittest import skipIf

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from realtime.metrics import get_counter
from realtime.views import RealtimeEventsSSEView

User = get_user_model()

EVENTS_URL = "/api/realtime/events/"
# What a browser's EventSource sends; it also picks the view's EventStreamRenderer.
EVENT_STREAM = "text/event-stream"


class RealtimeEventsStreamSwitchTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="rt_stream@example.com", password="x")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _open(self):
        return self.client.get(EVENTS_URL, HTTP_ACCEPT=EVENT_STREAM)

    @skipIf("REALTIME_SSE_ENABLED" in os.environ, "this environment sets REALTIME_SSE_ENABLED itself")
    def test_the_switch_is_off_unless_the_environment_turns_it_on(self):
        self.assertIs(settings.REALTIME_SSE_ENABLED, False)

    @override_settings(REALTIME_SSE_ENABLED=False)
    def test_off_it_answers_204_at_once_instead_of_streaming(self):
        resp = self._open()

        self.assertEqual(resp.status_code, 204)
        self.assertFalse(resp.streaming)

    @override_settings(REALTIME_SSE_ENABLED=False)
    def test_off_the_204_carries_no_body(self):
        # The view is called directly because the test client strips any 204 body. DRF's Response
        # would run None through EventStreamRenderer and send b"None" (rendered here as Django's
        # handler would).
        request = APIRequestFactory().get(EVENTS_URL, HTTP_ACCEPT=EVENT_STREAM)
        force_authenticate(request, user=self.user)
        resp = RealtimeEventsSSEView.as_view()(request)
        if hasattr(resp, "render"):
            resp.render()

        self.assertEqual(resp.status_code, 204)
        self.assertEqual(resp.content, b"")

    @override_settings(REALTIME_SSE_ENABLED=False)
    def test_off_it_counts_no_stream_open(self):
        before = get_counter("sse_stream_opens")

        self._open()

        self.assertEqual(get_counter("sse_stream_opens"), before)

    @override_settings()
    def test_a_settings_module_without_the_switch_does_not_stream(self):
        del settings.REALTIME_SSE_ENABLED

        resp = self._open()

        self.assertEqual(resp.status_code, 204)

    @override_settings(REALTIME_SSE_ENABLED=True)
    def test_on_it_still_streams(self):
        # Not iterated: the generator would hold this test for REALTIME_SSE_MAX_STREAM_S.
        resp = self._open()

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.streaming)
        self.assertEqual(resp["Content-Type"], EVENT_STREAM)
