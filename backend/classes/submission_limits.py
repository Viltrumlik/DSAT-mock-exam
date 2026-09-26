"""
Submission upload limits: file count, batch size, and throttling helpers.
"""

from __future__ import annotations

from django.conf import settings


def max_files_per_submission() -> int:
    return int(getattr(settings, "CLASSROOM_SUBMISSION_MAX_FILES_PER_SUBMISSION", 50))


def max_batch_upload_bytes() -> int:
    """Max total size of *new* files in one submit request (multipart batch)."""
    return int(getattr(settings, "CLASSROOM_SUBMISSION_MAX_BATCH_BYTES", 100 * 1024 * 1024))


def max_request_bytes() -> int:
    """What the proxy in front of Django will pass: Nginx's ``client_max_body_size`` for
    ``/api/``. Bigger bodies never arrive here to be refused politely."""
    return int(getattr(settings, "CLASSROOM_SUBMISSION_MAX_REQUEST_BYTES", 60 * 1024 * 1024))


def effective_batch_upload_bytes() -> int:
    """The largest batch a client can actually send.

    ``submit`` still enforces :func:`max_batch_upload_bytes` — it is the limit this service owns,
    and it is the one that belongs in its error message. This narrower figure is for the client:
    a batch between the two is refused at the proxy with an HTML 413 the student cannot read,
    which is a worse answer than being told while picking.
    """
    return min(max_batch_upload_bytes(), max_request_bytes())


def submission_limits_payload() -> dict:
    """What a submission may carry, for the upload panel to enforce before it sends.

    Every value is read from the settings the view re-checks on POST, so ops raising or lowering
    one with an environment variable moves the panel with it. Without this the client kept its
    own copies, and a copy that drifts tells a student a batch is fine and then loses it.
    """
    from .submission_validation import allowed_submission_extensions, max_submission_file_bytes

    return {
        "max_files_per_submission": max_files_per_submission(),
        "max_file_bytes": max_submission_file_bytes(),
        "max_batch_bytes": effective_batch_upload_bytes(),
        "allowed_extensions": sorted(allowed_submission_extensions()),
    }
