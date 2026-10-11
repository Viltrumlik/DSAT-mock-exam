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

from .conventions import iso


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
