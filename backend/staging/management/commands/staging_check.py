"""``manage.py staging_check [--json]`` — exits non-zero anywhere but the test copy.

The time machine (deploy/staging/stg_timemachine.py) runs every manage.py step with the release's environment file,
which names the database. It runs this first, so a prod environment file copied onto the copy by mistake stops the
action before ``migrate`` or the cutover's writes could reach prod's database."""

from __future__ import annotations

import json

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from staging.guard import toolbox_on


class Command(BaseCommand):
    help = "Exits non-zero unless this is the test copy (STAGING_TOOLBOX and its own database)."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="Print the result as one JSON line.")

    def handle(self, *args, **options):
        name = connection.settings_dict.get("NAME")
        if not toolbox_on():
            raise CommandError(
                f"This is not the test copy: STAGING_TOOLBOX is {getattr(settings, 'STAGING_TOOLBOX', None)!r} and "
                f"the database is {name!r}, not {getattr(settings, 'STAGING_DB_NAME', '')!r}."
            )
        result = {"database": name, "toolbox": True}
        self.stdout.write(json.dumps(result) if options["json"] else f"The test copy, database {name}.")
