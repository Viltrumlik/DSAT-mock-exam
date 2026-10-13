"""Where the integration reads its switches and credentials — one place, so nothing else touches
``settings.LCUP_*`` directly and a test can override them with ``override_settings``."""

import re

from django.conf import settings


def lcup_enabled() -> bool:
    return bool(getattr(settings, "LCUP_ENABLED", False))


def credentials() -> dict:
    return {
        "base_url": (getattr(settings, "LCUP_BASE_URL", "") or "").strip().rstrip("/"),
        "domain": (getattr(settings, "LCUP_DOMAIN", "") or "").strip(),
        # lc-up's login takes "998901234567" and answers 422 to "+998 90 …", which is how people write it.
        "mobile": re.sub(r"\D", "", getattr(settings, "LCUP_MOBILE", "") or ""),
        "password": getattr(settings, "LCUP_PASSWORD", "") or "",
    }
