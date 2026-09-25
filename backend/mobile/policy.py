"""The release policy, read cheaply.

The version gate runs in middleware on every API request an app makes, so the row is cached
for a minute rather than read each time. A minute is the whole cost of the cache: raising the
minimum takes effect on phones within sixty seconds, which is fast enough for any real use and
far faster than the deploy an env var would need.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.core.cache import cache

from .models import AppReleasePolicy
from .versioning import Version, evaluate, format_version, parse_version

CACHE_SECONDS = 60


def _cache_key(platform: str) -> str:
    return f"mobile:policy:{platform}"


@dataclass(frozen=True)
class Policy:
    platform: str
    latest: Version | None
    minimum: Version | None
    update_url: str
    message: str

    def verdict(self, current: Version | None) -> str:
        return evaluate(current, minimum=self.minimum, latest=self.latest)

    def as_payload(self, current: Version | None) -> dict:
        return {
            "platform": self.platform,
            "latest_version": format_version(self.latest),
            "minimum_version": format_version(self.minimum),
            "update_url": self.update_url,
            "message": self.message,
            "update": self.verdict(current),
        }


def get_policy(platform: str) -> Policy:
    """The platform's policy — an empty one (nothing required) when no row exists."""
    key = _cache_key(platform)
    try:
        cached = cache.get(key)
    except Exception:  # pragma: no cover - a cache outage must not take the API down
        cached = None
    if isinstance(cached, Policy):
        return cached

    row = AppReleasePolicy.objects.filter(platform=platform).first()
    policy = Policy(
        platform=platform,
        latest=parse_version(row.latest_version) if row else None,
        minimum=parse_version(row.minimum_version) if row else None,
        update_url=(row.update_url or "") if row else "",
        message=(row.message or "") if row else "",
    )
    try:
        cache.set(key, policy, CACHE_SECONDS)
    except Exception:  # pragma: no cover
        pass
    return policy


def forget_policy(platform: str) -> None:
    """Drop the cached copy, so a change made in the console applies at once on this node."""
    try:
        cache.delete(_cache_key(platform))
    except Exception:  # pragma: no cover
        pass
