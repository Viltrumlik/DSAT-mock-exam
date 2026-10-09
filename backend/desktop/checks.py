"""Say so loudly when the midterm rule is on but no app could ever satisfy it.

A Warning, not an Error: an Error stops ``migrate``, and a deploy that dies at migrate leaves
the site down — a far worse outcome than the one this check is warning about.
"""

from __future__ import annotations

from django.conf import settings
from django.core.checks import Warning, register


@register()
def proof_keys_configured(app_configs, **kwargs):
    if getattr(settings, "MIDTERM_DESKTOP_REQUIRED", False) and not getattr(settings, "DESKTOP_PROOF_KEYS", None):
        return [
            Warning(
                "MIDTERM_DESKTOP_REQUIRED is on but DESKTOP_PROOF_KEYS is empty: no app build can "
                "prove it is locked down, so no student can start a midterm.",
                hint="Set DESKTOP_PROOF_KEYS=<key_id>:<hex secret> (the key the Windows build was "
                "compiled with), or turn MIDTERM_DESKTOP_REQUIRED off.",
                id="desktop.W001",
            )
        ]
    return []
