"""Whether this process is the test copy (/var/www/satapp-staging) — the one switch every staging-only behaviour reads.

Two locks, both needed: the environment's ``STAGING_TOOLBOX`` flag, and the live connection's database being the
copy's own (``STAGING_DB_NAME``, "mastersat_staging" unless told). A prod environment file copied by mistake still
points at prod's database, so the toolbox stays off there; the third lock is the host (nginx serves the copy only on
its own names)."""

from django.conf import settings
from django.db import connection


def toolbox_on() -> bool:
    """True only on the test copy: ``settings.STAGING_TOOLBOX`` is True AND the live connection's database name equals
    ``settings.STAGING_DB_NAME``."""
    if getattr(settings, "STAGING_TOOLBOX", False) is not True:
        return False
    name = str(getattr(settings, "STAGING_DB_NAME", "") or "").strip()
    return bool(name) and connection.settings_dict.get("NAME") == name
