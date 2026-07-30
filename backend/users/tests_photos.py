"""Profile photo plumbing — the URL builder, the downscaler, and the two payloads that
carry a photo to every roster in the app.
"""

from __future__ import annotations

import io

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, TestCase, override_settings
from PIL import Image

from users.photos import PROFILE_IMAGE_MAX_PX, downscale_profile_image, profile_image_url
from users.serializers import UserMeSerializer, UserSerializer

User = get_user_model()


def _jpeg(width: int, height: int, *, name: str = "photo.jpg") -> SimpleUploadedFile:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (120, 90, 200)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


@override_settings(ALLOWED_HOSTS=["mastersat.uz", "teacher.mastersat.uz", "testserver"])
class ProfileImageUrlTests(TestCase):
    def setUp(self):
        self.rf = RequestFactory()
        self.user = User.objects.create_user(email="p@example.com", password="x")

    def test_none_when_no_photo_uploaded(self):
        self.assertIsNone(profile_image_url(self.user, self.rf.get("/")))

    def test_absolute_url_when_a_request_is_supplied(self):
        self.user.profile_image = _jpeg(64, 64)
        self.user.save(update_fields=["profile_image"])

        url = profile_image_url(self.user, self.rf.get("/", HTTP_HOST="teacher.mastersat.uz"))

        # Absolute and host-derived. A relative /media/ path resolves only on whichever
        # host serves the images, and fails silently everywhere else.
        self.assertTrue(url.startswith("http://teacher.mastersat.uz/"), url)
        self.assertIn("/media/", url)

    def test_host_follows_the_request_not_a_hardcoded_domain(self):
        self.user.profile_image = _jpeg(64, 64)
        self.user.save(update_fields=["profile_image"])

        student = profile_image_url(self.user, self.rf.get("/", HTTP_HOST="mastersat.uz"))
        teacher = profile_image_url(self.user, self.rf.get("/", HTTP_HOST="teacher.mastersat.uz"))

        self.assertNotEqual(student, teacher)

    def test_degrades_to_a_relative_path_without_a_request(self):
        self.user.profile_image = _jpeg(64, 64)
        self.user.save(update_fields=["profile_image"])
        self.assertTrue(profile_image_url(self.user, None).startswith("/"))


class DownscaleTests(TestCase):
    def test_large_upload_is_shrunk_to_the_cap(self):
        original = _jpeg(3024, 4032)  # a plain phone photo
        shrunk = downscale_profile_image(original)

        with Image.open(shrunk) as im:
            self.assertLessEqual(max(im.size), PROFILE_IMAGE_MAX_PX)
        self.assertLess(shrunk.size, original.size)

    def test_aspect_ratio_is_preserved(self):
        shrunk = downscale_profile_image(_jpeg(2000, 1000))
        with Image.open(shrunk) as im:
            self.assertAlmostEqual(im.size[0] / im.size[1], 2.0, places=2)

    def test_small_upload_is_left_untouched(self):
        original = _jpeg(200, 200)
        self.assertIs(downscale_profile_image(original), original)

    def test_a_non_image_is_returned_unchanged_rather_than_raising(self):
        # A profile photo is never worth failing a request over; validate_profile_image
        # already rejects non-image content types, so anything reaching here is Pillow's
        # problem and the original is stored as-is.
        junk = SimpleUploadedFile("x.jpg", b"not an image", content_type="image/jpeg")
        self.assertIs(downscale_profile_image(junk), junk)

    def test_upload_through_the_serializer_is_stored_downscaled(self):
        """UserMeSerializer (PATCH /api/users/me/) is the only upload path in the app,
        so hooking the downscale into its validation covers every photo that lands."""
        user = User.objects.create_user(email="up@example.com", password="x")
        ser = UserMeSerializer(user, data={"profile_image": _jpeg(2400, 2400)}, partial=True)
        self.assertTrue(ser.is_valid(), ser.errors)
        ser.save()

        user.refresh_from_db()
        with Image.open(user.profile_image) as im:
            self.assertLessEqual(max(im.size), PROFILE_IMAGE_MAX_PX)


@override_settings(ALLOWED_HOSTS=["mastersat.uz", "teacher.mastersat.uz", "testserver"])
class SerializerPhotoFieldTests(TestCase):
    """The one field that lights up /ops/users, /ops/access and the classroom pickers."""

    def setUp(self):
        self.rf = RequestFactory()

    def test_user_serializer_emits_an_absolute_photo_url(self):
        user = User.objects.create_user(email="s@example.com", password="x")
        user.profile_image = _jpeg(64, 64)
        user.save(update_fields=["profile_image"])

        data = UserSerializer(user, context={"request": self.rf.get("/", HTTP_HOST="mastersat.uz")}).data

        self.assertTrue(data["profile_image_url"].startswith("http://mastersat.uz/"))

    def test_user_serializer_emits_null_for_a_user_with_no_photo(self):
        user = User.objects.create_user(email="n@example.com", password="x")
        data = UserSerializer(user, context={"request": self.rf.get("/")}).data
        self.assertIsNone(data["profile_image_url"])

    def test_photo_url_is_read_only(self):
        # UserSerializer also backs public registration; nothing about a photo URL should
        # ever be writable through it.
        self.assertTrue(UserSerializer().fields["profile_image_url"].read_only)
