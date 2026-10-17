"""The Bot API wrapper's new half: a picture upload, its file_id, and Telegram's retry_after."""

from __future__ import annotations

import io
import json
import urllib.error
from unittest import mock

from django.test import SimpleTestCase, override_settings

from classes import telegram_group_api as api

TOKEN = "777:TESTTOKEN"


class _Resp:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _capture(payload=None):
    seen = []

    def fake_urlopen(req, timeout=None):
        seen.append(req)
        return _Resp(payload or {"ok": True, "result": {"message_id": 5, "photo": []}})

    return seen, mock.patch.object(api.urllib.request, "urlopen", side_effect=fake_urlopen)


@override_settings(CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN)
class SendPhotoTests(SimpleTestCase):
    def test_a_known_file_id_is_sent_as_a_form_field(self):
        seen, patch = _capture()
        with patch:
            result = api.send_photo("-1001", caption="<b>Hi</b>", file_id="FILE123")
        self.assertTrue(result.ok)
        body = seen[0].data.decode()
        self.assertIn("photo=FILE123", body)
        self.assertIn("parse_mode=HTML", body)
        self.assertTrue(seen[0].full_url.endswith("/sendPhoto"))

    def test_bytes_are_uploaded_as_multipart(self):
        seen, patch = _capture()
        markup = {"inline_keyboard": [[{"text": "Go", "url": "https://mastersat.uz/events"}]]}
        with patch:
            api.send_photo(
                "-1001", caption="Hi", photo=b"\x89PNGDATA", filename='co"ver.png',
                content_type="image/png", reply_markup=markup,
            )
        req = seen[0]
        self.assertTrue(req.get_header("Content-type").startswith("multipart/form-data; boundary="))
        self.assertIn(b"\x89PNGDATA", req.data)
        self.assertIn(b'name="caption"', req.data)
        # A quote in a file name would end the header early; it is replaced, never sent.
        self.assertIn(b'filename="co_ver.png"', req.data)
        self.assertIn(b"inline_keyboard", req.data)

    def test_nothing_to_send_is_a_refusal_not_a_call(self):
        seen, patch = _capture()
        with patch:
            result = api.send_photo("-1001", caption="Hi")
        self.assertFalse(result.ok)
        self.assertEqual(seen, [])


@override_settings(CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN)
class RetryAfterTests(SimpleTestCase):
    def test_a_429_carries_telegrams_retry_after(self):
        body = json.dumps({
            "ok": False, "error_code": 429, "description": "Too Many Requests: retry after 7",
            "parameters": {"retry_after": 7},
        }).encode()
        err = urllib.error.HTTPError(
            "https://api.telegram.org", 429, "Too Many Requests", hdrs=None, fp=io.BytesIO(body)
        )
        with mock.patch.object(api.urllib.request, "urlopen", side_effect=err):
            result = api.send_message("-1001", "hi")
        self.assertFalse(result.ok)
        self.assertEqual(result.error_code, 429)
        self.assertEqual(result.retry_after, 7)

    def test_other_failures_have_none(self):
        with mock.patch.object(api.urllib.request, "urlopen", side_effect=TimeoutError("timed out")):
            result = api.send_message("-1001", "hi")
        self.assertIsNone(result.retry_after)
        self.assertIsNone(result.error_code)


class LargestPhotoTests(SimpleTestCase):
    def test_the_biggest_size_wins(self):
        result = {"photo": [
            {"file_id": "s", "file_size": 100, "width": 90},
            {"file_id": "l", "file_size": 9000, "width": 1280},
            {"file_id": "m", "file_size": 900, "width": 320},
        ]}
        self.assertEqual(api.largest_photo_file_id(result), "l")

    def test_no_photo_is_empty(self):
        self.assertEqual(api.largest_photo_file_id({"message_id": 1}), "")
        self.assertEqual(api.largest_photo_file_id(None), "")
