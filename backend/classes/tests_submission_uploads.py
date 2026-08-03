"""Regression: homework submission upload against an S3-shaped storage backend.

Every homework submission on production 500'd with
``AttributeError: '_HashingReader' object has no attribute 'closed'``.

The chain: ``stream_upload_to_storage`` handed ``default_storage.save`` a bespoke hashing
wrapper; Django wraps anything it is given in ``File``, whose ``closed`` delegates to the
wrapped object; and the S3 backend calls ``is_seekable(content)`` before uploading, which
reaches ``File.seekable() -> self.closed -> self.file.closed``. The wrapper had no
``closed``, so the POST 500'd.

It was invisible in tests because the local FileSystemStorage never probes for those
attributes — it just reads chunks. So these tests do NOT use the real storage: they use a
stub that probes the content exactly as django-storages does. That probe is the regression.

    python manage.py test classes.tests_submission_uploads --settings=config.settings_test_nomigrations
"""

from __future__ import annotations

import hashlib

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from classes.submission_uploads import (
    SubmissionUploadTokenError,
    sha256_of_upload,
    stream_upload_to_storage,
)

BODY = b"a homework photo, pretend this is a jpeg" * 500
TOKEN = "tok-abcdefgh"


class _S3ShapedStorage:
    """A storage that probes its content the way ``storages.backends.s3`` does.

    Reproduces the production failure without boto3: the point is that the object handed to
    ``save`` must survive ``is_seekable()``, which touches ``.seekable()`` -> ``.closed``.
    """

    def __init__(self):
        self.saved: dict[str, bytes] = {}
        self.deleted: list[str] = []

    def exists(self, name):
        return name in self.saved

    def delete(self, name):
        self.deleted.append(name)
        self.saved.pop(name, None)

    def save(self, name, content, max_length=None):
        from django.core.files.base import File

        if not hasattr(content, "chunks"):
            content = File(content, name)
        # THE probe that broke production — django-storages' is_seekable(), verbatim shape.
        if not hasattr(content, "seekable") or content.seekable():
            content.seek(0)
        self.saved[name] = b"".join(content.chunks())
        return name


class SubmissionUploadTests(TestCase):
    def setUp(self):
        self.storage = _S3ShapedStorage()
        patcher = override_settings()
        patcher.enable()
        self.addCleanup(patcher.disable)
        import classes.submission_uploads as mod

        self._real = mod.default_storage
        mod.default_storage = self.storage
        self.addCleanup(setattr, mod, "default_storage", self._real)

    def _upload(self, name="IMG_20260803_004735.jpg", body=BODY):
        return SimpleUploadedFile(name, body, content_type="image/jpeg")

    def test_an_upload_survives_a_storage_that_probes_it(self):
        """The production 500, in one assertion."""
        staged = stream_upload_to_storage(41, self._upload(), upload_token=TOKEN)
        self.assertTrue(staged.storage_path)
        self.assertEqual(self.storage.saved[staged.storage_path], BODY)

    def test_the_whole_file_reaches_storage(self):
        staged = stream_upload_to_storage(41, self._upload(), upload_token=TOKEN)
        self.assertEqual(len(self.storage.saved[staged.storage_path]), len(BODY))

    def test_the_hash_is_of_the_bytes_that_were_stored(self):
        staged = stream_upload_to_storage(41, self._upload(), upload_token=TOKEN)
        self.assertEqual(staged.content_sha256, hashlib.sha256(BODY).hexdigest())
        self.assertEqual(
            staged.content_sha256,
            hashlib.sha256(self.storage.saved[staged.storage_path]).hexdigest(),
        )

    def test_hashing_does_not_consume_the_file(self):
        """The hash pass must rewind, or storage would save zero bytes."""
        uf = self._upload()
        digest = sha256_of_upload(uf)
        self.assertEqual(digest, hashlib.sha256(BODY).hexdigest())
        self.assertEqual(uf.read(), BODY)

    def test_an_empty_file_still_hashes(self):
        staged = stream_upload_to_storage(41, self._upload(body=b""), upload_token=TOKEN)
        self.assertEqual(staged.content_sha256, hashlib.sha256(b"").hexdigest())

    def test_metadata_survives(self):
        staged = stream_upload_to_storage(41, self._upload(), upload_token=TOKEN)
        self.assertEqual(staged.file_name, "IMG_20260803_004735.jpg")
        self.assertEqual(staged.file_type, "image/jpeg")
        self.assertEqual(staged.upload_token, TOKEN)

    def test_the_same_token_reuses_one_key_and_clears_the_old_object(self):
        first = stream_upload_to_storage(41, self._upload(), upload_token=TOKEN)
        second = stream_upload_to_storage(41, self._upload(), upload_token=TOKEN)
        self.assertEqual(first.storage_path, second.storage_path)
        self.assertIn(first.storage_path, self.storage.deleted)

    def test_a_different_token_gets_a_different_key(self):
        a = stream_upload_to_storage(41, self._upload(), upload_token=TOKEN)
        b = stream_upload_to_storage(41, self._upload(), upload_token="tok-zyxwvuts")
        self.assertNotEqual(a.storage_path, b.storage_path)

    def test_a_short_token_is_refused(self):
        with self.assertRaises(SubmissionUploadTokenError):
            stream_upload_to_storage(41, self._upload(), upload_token="short")

    def test_a_plain_file_object_without_chunks_also_works(self):
        import io

        buf = io.BytesIO(BODY)
        buf.name = "notes.txt"
        staged = stream_upload_to_storage(41, buf, upload_token=TOKEN)
        self.assertEqual(staged.content_sha256, hashlib.sha256(BODY).hexdigest())
        self.assertEqual(self.storage.saved[staged.storage_path], BODY)
