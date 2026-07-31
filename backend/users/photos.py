"""Profile photo helpers — one URL builder, one downscaler, used app-wide.

Every surface that names a person should be able to show their face, which means roughly
thirty serializers and hand-built row dicts need the same two lines. They used to write those
lines themselves, three of them wrongly (relative URLs), so both halves live here now.
"""

from __future__ import annotations

import io
import os

from django.core.files.uploadedfile import InMemoryUploadedFile

# Roster cells render at 18-64px and the podium at 64px, so a 512px square is already
# generous on a 2x display. Uploads are phone camera JPEGs — several megapixels each — and
# a 200-student roster would otherwise pull hundreds of megabytes through the wire to draw
# 24px circles. Disk on this box has been a live incident once already.
PROFILE_IMAGE_MAX_PX = 512
PROFILE_IMAGE_JPEG_QUALITY = 85


def profile_image_url(user, request=None) -> str | None:
    """Absolute URL of a user's profile photo, or None when they have not set one.

    Absolute because the same payload is served to the student site, the teacher subdomain
    and the ops app. A relative ``/media/`` path only resolves on whichever host happens to
    serve the images, and it fails *silently*: the frontend Avatar falls back to initials on
    error, so a broken deploy is indistinguishable from "no photo uploaded".

    ``request`` is optional only so callers deep in a helper can degrade rather than crash —
    pass it wherever you have it.
    """
    image = getattr(user, "profile_image", None)
    if not image:
        return None
    try:
        url = image.url
    except ValueError:  # pragma: no cover - FileField with no underlying file
        return None
    return request.build_absolute_uri(url) if request is not None else url


def downscale_profile_image(uploaded):
    """Shrink an uploaded profile photo to at most ``PROFILE_IMAGE_MAX_PX`` on its long edge.

    Returns a replacement upload, or the original untouched when it is already small enough,
    is not a raster image, or Pillow cannot read it — a profile photo is never worth failing
    a request over, and the size cap in ``validate_profile_image`` still bounds the damage.

    Animated GIFs are passed through: re-encoding one to a still frame is a worse outcome
    than storing it as-is, and they are rare enough not to matter for transfer.
    """
    if uploaded is None:
        return uploaded
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover - Pillow ships with Django's ImageField
        return uploaded

    try:
        uploaded.seek(0)
        image = Image.open(uploaded)
        image.load()
    except Exception:
        # Not a raster image, or truncated. validate_profile_image already rejected
        # non-image content types; anything left here is Pillow's problem, not the user's.
        try:
            uploaded.seek(0)
        except Exception:
            pass
        return uploaded

    if getattr(image, "is_animated", False):
        uploaded.seek(0)
        return uploaded

    if max(image.size) <= PROFILE_IMAGE_MAX_PX:
        uploaded.seek(0)
        return uploaded

    # exif_transpose first: phone photos carry a rotation flag that thumbnail() ignores, so
    # skipping this stores a sideways face.
    image = ImageOps.exif_transpose(image)
    image.thumbnail((PROFILE_IMAGE_MAX_PX, PROFILE_IMAGE_MAX_PX), Image.LANCZOS)

    keep_alpha = image.mode in ("RGBA", "LA", "P") and "transparency" in image.info
    if keep_alpha:
        fmt, ext, content_type = "PNG", ".png", "image/png"
        image = image.convert("RGBA")
        params = {"optimize": True}
    else:
        fmt, ext, content_type = "JPEG", ".jpg", "image/jpeg"
        image = image.convert("RGB")
        params = {"quality": PROFILE_IMAGE_JPEG_QUALITY, "optimize": True, "progressive": True}

    buffer = io.BytesIO()
    try:
        image.save(buffer, format=fmt, **params)
    except Exception:  # pragma: no cover - encoder failure, keep the original
        uploaded.seek(0)
        return uploaded

    size = buffer.tell()
    buffer.seek(0)
    stem = os.path.splitext(os.path.basename(getattr(uploaded, "name", "profile") or "profile"))[0]
    return InMemoryUploadedFile(
        buffer, "profile_image", f"{stem}{ext}", content_type, size, None
    )
