"""Signed image URLs for the app's image cache.

The app caches every image by its storage KEY (safe: ``file_overwrite=False`` means a key never
gets new bytes), so a URL only has to live until it is downloaded. Each distinct key is signed
once per response. There is deliberately no "sign these keys for me" endpoint: the bucket also
holds student submissions, so v1 only ever signs the images of the caller's own attempt.
"""

from __future__ import annotations

import datetime as _dt
from typing import Iterable

from django.core.files.storage import default_storage
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated

from access.permissions import RequiresSubmitTest

from .conventions import V1APIView, iso, midterm_media_ttl, not_visible, ok, pastpaper_media_ttl


def sign(key: str, ttl_seconds: int) -> str:
    """A URL for ``key`` valid for about ``ttl_seconds``.

    R2/S3 storage signs with the requested lifetime (django-storages
    ``S3Storage.url(name, parameters=None, expire=None, http_method=None)``). Local disk storage
    has no signing and no ``expire`` argument; its plain ``/media/…`` URL is returned.
    """
    try:
        return default_storage.url(key, expire=int(ttl_seconds))
    except TypeError:
        return default_storage.url(key)


def signed_media(keys: Iterable[str], *, ttl_seconds: int, request=None) -> list[dict]:
    """``[{key, url, expires_at}]`` — absolute URLs, each key once, in the order given."""
    now = timezone.now()
    expires_at = iso(now + _dt.timedelta(seconds=int(ttl_seconds)))
    out: list[dict] = []
    seen: set[str] = set()
    for key in keys:
        if not key or key in seen:
            continue
        seen.add(key)
        url = sign(key, ttl_seconds)
        if url.startswith("/") and request is not None:
            url = request.build_absolute_uri(url)
        out.append({"key": key, "url": url, "expires_at": expires_at})
    return out


# ── GET attempts/{pastpaper|midterm}/{id}/media ──────────────────────────────────────────
def _pastpaper_keys(request, attempt_id: int) -> list[str]:
    from .pastpapers import is_deferred, own_attempt
    from .snapshots import fresh_pastpaper, pastpaper_modules
    from . import content

    own_attempt(request, attempt_id)
    attempt = fresh_pastpaper(attempt_id)
    modules = [m for m in pastpaper_modules(attempt) if not is_deferred(attempt, m)]
    by_module = content.questions_by_module([m.id for m in modules])
    keys: list[str] = []
    for module in modules:
        keys.extend(content.image_keys(content.questions_payload(by_module.get(module.id, []))))
    return keys


def _midterm_keys(request, attempt_id: int) -> list[str]:
    """The live module's images only, and only to the window holding the lockdown token.
    Nothing before the sitting starts, nothing once it is handed in (a midterm's result is a
    score, never the paper)."""
    from midterms.state_machine import STATE_ACTIVE, STATE_MODULE_2_ACTIVE

    from . import content
    from .midterms import own_attempt, require_lockdown
    from .snapshots import fresh_midterm

    attempt = own_attempt(request, attempt_id)
    require_lockdown(request, attempt)
    attempt = fresh_midterm(attempt_id)
    if attempt.current_state not in (STATE_ACTIVE, STATE_MODULE_2_ACTIVE):
        return []
    questions = list(attempt.effective_questions_for_order(attempt.current_module_order))
    return content.image_keys(content.questions_payload(questions))


class AttemptMediaView(V1APIView):
    """Fresh signed URLs for the images of THIS attempt's modules — for when the ones in the
    bundle expired before the app fetched them (a laptop asleep overnight)."""

    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        perms = super().get_permissions()
        if self.kwargs.get("kind") == "pastpaper":
            perms.append(RequiresSubmitTest())  # the past-paper endpoints' own gate
        return perms

    def get(self, request, kind: str, attempt_id: int):
        if kind == "pastpaper":
            keys, ttl = _pastpaper_keys(request, attempt_id), pastpaper_media_ttl()
        elif kind == "midterm":
            keys, ttl = _midterm_keys(request, attempt_id), midterm_media_ttl()
        else:
            raise not_visible()
        return ok({"attempt_id": int(attempt_id), "kind": kind, "media": signed_media(keys, ttl_seconds=ttl, request=request)})
