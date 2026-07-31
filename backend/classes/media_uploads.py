"""Presigned direct-to-R2 upload for lesson videos.

A lesson video can be 2 GB. Streaming that through nginx + a gunicorn worker would tie the
worker up for the whole upload, so instead the browser uploads STRAIGHT to R2 via a
presigned PUT URL, and the app only records the resulting object key (``video_key``) on the
homework. The bucket must allow the app origin in its CORS policy (set once in the
Cloudflare R2 dashboard) for the browser PUT to succeed.
"""

from __future__ import annotations

import os
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError

# Where every uploaded lesson video lands. Save handlers reject any key outside this prefix
# so a presigned URL can't be repurposed to point a homework at an arbitrary object.
VIDEO_KEY_PREFIX = "homework_videos/"

# ext -> content type. Signing the content type pins what the browser must send on PUT and
# gives the stored object a correct type so it plays inline instead of downloading.
VIDEO_CONTENT_TYPES = {
    "mp4": "video/mp4",
    "m4v": "video/mp4",
    "mov": "video/quicktime",
    "webm": "video/webm",
    "ogg": "video/ogg",
    "ogv": "video/ogg",
    "mkv": "video/x-matroska",
}


def max_video_bytes() -> int:
    """Upload ceiling (default 2 GB), enforced client-side and re-checked on save."""
    return int(getattr(settings, "HOMEWORK_VIDEO_MAX_BYTES", 2 * 1024 * 1024 * 1024))


def r2_configured() -> bool:
    return bool(os.getenv("R2_BUCKET", "").strip())


def _ext_of(filename: str) -> str:
    name = (filename or "").strip().lower()
    return name.rsplit(".", 1)[-1] if "." in name else ""


def _client_and_bucket():
    """boto3 S3 client + bucket, built from the same R2 env the storage backend uses."""
    import boto3
    from botocore.config import Config

    bucket = os.getenv("R2_BUCKET", "").strip()
    client = boto3.client(
        "s3",
        endpoint_url=os.getenv("R2_ENDPOINT_URL", "").strip(),
        aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID", "").strip(),
        aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY", "").strip(),
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )
    return client, bucket


def is_video_key(key: str) -> bool:
    if not key or not isinstance(key, str):
        return False
    if not key.startswith(VIDEO_KEY_PREFIX):
        return False
    # No traversal / nested surprises: exactly prefix + one filename segment.
    tail = key[len(VIDEO_KEY_PREFIX):]
    if not tail or "/" in tail or ".." in tail:
        return False
    return _ext_of(tail) in VIDEO_CONTENT_TYPES


def presign_video_put(filename: str) -> dict:
    """Return ``{upload_url, key, content_type, max_bytes, expires_in}`` for a browser PUT.

    Raises ``ValidationError`` on an unsupported extension or when R2 is not configured.
    """
    if not r2_configured():
        raise ValidationError("Video uploads are not available (object storage not configured).")
    ext = _ext_of(filename)
    content_type = VIDEO_CONTENT_TYPES.get(ext)
    if not content_type:
        allowed = ", ".join(sorted(VIDEO_CONTENT_TYPES))
        raise ValidationError(f"Unsupported video type “.{ext}”. Allowed: {allowed}.")

    key = f"{VIDEO_KEY_PREFIX}{uuid.uuid4().hex}.{ext}"
    client, bucket = _client_and_bucket()
    expires_in = 3600
    upload_url = client.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=expires_in,
    )
    return {
        "upload_url": upload_url,
        "key": key,
        "content_type": content_type,
        "max_bytes": max_video_bytes(),
        "expires_in": expires_in,
    }


def object_size(key: str) -> int | None:
    """HEAD the object to read its size; None if it does not exist / on error."""
    if not r2_configured():
        return None
    try:
        client, bucket = _client_and_bucket()
        head = client.head_object(Bucket=bucket, Key=key)
        return int(head.get("ContentLength") or 0)
    except Exception:
        return None


def delete_object(key: str) -> None:
    """Best-effort delete (used to reject an over-size upload after the fact)."""
    if not key or not r2_configured():
        return
    try:
        client, bucket = _client_and_bucket()
        client.delete_object(Bucket=bucket, Key=key)
    except Exception:
        pass


def resolve_video_key(key: str) -> str:
    """Validate a client-supplied ``video_key`` and enforce the size ceiling.

    Returns the key to store, or raises ``ValidationError``. An over-size object is deleted
    so a rejected upload doesn't linger in the bucket.
    """
    if not is_video_key(key):
        raise ValidationError("Invalid video upload reference.")
    size = object_size(key)
    if size is not None and size > max_video_bytes():
        delete_object(key)
        gb = max_video_bytes() / (1024 * 1024 * 1024)
        raise ValidationError(f"Video is too large (max {gb:.0f} GB).")
    return key
