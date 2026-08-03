"""
Stream homework uploads to storage while computing SHA-256 (no full-file RAM buffer).

Storage keys are **deterministic** per submission + ``upload_token`` (required, min 8 characters):
``homework_submissions/staging/s{submission_id}/t{sha256(token)[:32]}/data{ext}``

Retries with the same token delete-then-save the same object (no duplicate blobs).
"""

from __future__ import annotations

import hashlib
import mimetypes
import os
import re
from dataclasses import dataclass

from django.core.files.storage import default_storage


class SubmissionUploadTokenError(ValueError):
    """Raised when ``upload_token`` is missing or too short."""


@dataclass(frozen=True, slots=True)
class StagedUpload:
    """Result of streaming one file to storage before the DB commit."""

    storage_path: str
    file_name: str
    file_type: str
    content_sha256: str
    upload_token: str


_HASH_CHUNK = 1024 * 1024


def _rewind(uf) -> None:
    if hasattr(uf, "seek"):
        try:
            uf.seek(0)
        except Exception:
            pass


def sha256_of_upload(uf) -> str:
    """SHA-256 of an upload, read in chunks and rewound afterwards.

    Deliberately a SEPARATE pass rather than a file-like wrapper that hashes as storage
    reads it. That wrapper is what broke every homework submission on R2: Django wraps
    whatever it is handed in ``File``, whose ``closed`` delegates to the wrapped object, and
    the S3 backend probes ``is_seekable(content)`` before uploading — so a wrapper missing
    ``closed`` raised AttributeError and the POST 500'd.

    Adding ``closed``/``seekable`` to the wrapper would have silenced that, but left a worse
    bug behind: boto3's transfer manager chooses its upload strategy by probing for ``seek``
    and ``tell``, and for a seekable stream a multipart upload issues CONCURRENT ranged
    reads. A hash accumulated inside the reader would then be computed over interleaved,
    partly-repeated bytes — silently wrong, and only on the large files nobody re-checks.
    Handing storage the real ``UploadedFile`` removes that whole class of problem.

    The cost is one extra pass. ``chunks()`` streams it, so the module's promise of no
    full-file RAM buffer still holds.
    """
    h = hashlib.sha256()
    _rewind(uf)
    chunks = getattr(uf, "chunks", None)
    if callable(chunks):
        for chunk in chunks(_HASH_CHUNK):
            h.update(chunk)
    else:  # a plain file object — read it the long way
        while True:
            chunk = uf.read(_HASH_CHUNK)
            if not chunk:
                break
            h.update(chunk)
    _rewind(uf)
    return h.hexdigest()


def _sanitize_ext(safe_basename: str) -> str:
    _, ext = os.path.splitext(safe_basename)
    ext = ext.lower()
    if not ext or len(ext) > 16:
        return ""
    if not re.match(r"^\.[a-z0-9]+$", ext):
        return ""
    return ext


def require_upload_token(raw: str | None) -> str:
    """Require a client-supplied idempotency token (min 8 chars)."""
    t = (raw or "").strip()
    if len(t) < 8:
        raise SubmissionUploadTokenError("Each file requires upload_token (min 8 characters).")
    return t[:64]


def _deterministic_object_key(submission_id: int, token: str, safe_basename: str) -> str:
    th = hashlib.sha256(token.encode("utf-8")).hexdigest()[:32]
    ext = _sanitize_ext(safe_basename)
    return f"homework_submissions/staging/s{submission_id}/t{th}/data{ext}"


def stream_upload_to_storage(
    submission_id: int,
    uf,
    *,
    upload_token: str | None = None,
) -> StagedUpload:
    """
    Stream ``uf`` to default storage. ``upload_token`` is **required** (min 8 characters).
    """
    _rewind(uf)

    raw_name = getattr(uf, "name", None) or "upload"
    safe = os.path.basename(str(raw_name)) or "upload"
    token = require_upload_token(upload_token)
    key = _deterministic_object_key(submission_id, token, safe)

    try:
        if key and default_storage.exists(key):
            default_storage.delete(key)
    except Exception:
        pass

    # Hash FIRST, then hand storage the upload itself. See sha256_of_upload for why this is
    # two passes rather than a hashing wrapper.
    digest = sha256_of_upload(uf)
    path = default_storage.save(key, uf)
    guessed = getattr(uf, "content_type", None) or mimetypes.guess_type(safe)[0] or ""
    return StagedUpload(
        storage_path=path,
        file_name=safe[:255],
        file_type=(guessed or "")[:120],
        content_sha256=digest,
        upload_token=token,
    )


def delete_staged_paths(paths: list[str]) -> None:
    """Best-effort cleanup if the DB transaction never commits (compensation)."""
    for p in paths:
        try:
            if p and default_storage.exists(p):
                default_storage.delete(p)
        except Exception:
            pass


def abandon_staged_uploads(submission_id: int, paths: list[str]) -> None:
    """Delete storage objects and mark optional ``HomeworkStagedUpload`` rows abandoned."""
    delete_staged_paths(paths)
    if not paths:
        return
    try:
        from .models import HomeworkStagedUpload

        HomeworkStagedUpload.objects.filter(
            submission_id=submission_id,
            storage_path__in=[p for p in paths if p],
        ).update(status=HomeworkStagedUpload.STATUS_ABANDONED)
    except Exception:
        pass
