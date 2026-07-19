"""Branding context shared by every outbound message.

``render_to_string`` is called without a request when mail is sent from a Celery
task or a management command, and context processors do not run in that case. So
the shell's brand values are assembled here and merged in explicitly by each
sender rather than being injected by the template engine.

Every URL is absolute. A mail client has no origin to resolve ``/static/...``
against, so a relative logo path renders as a broken image in every inbox.
"""
from __future__ import annotations

from django.conf import settings


def _site_url() -> str:
    return str(getattr(settings, "EMAIL_SITE_URL", "https://mastersat.uz")).rstrip("/")


def brand_context(**extra) -> dict:
    """Base context for ``email/base.html``, plus whatever the message adds.

    The logo is referenced by its UNHASHED static path on purpose. WhiteNoise's
    manifest storage writes both ``logo.png`` and ``logo.<hash>.png``, and a
    message sits in someone's inbox for years — pinning the hash would 404 every
    old message the first time the asset is touched.
    """
    site = _site_url()
    return {
        "site_url": site,
        "login_url": f"{site}/login",
        "logo_url": f"{site}{settings.STATIC_URL}email/logo.png",
        **extra,
    }
