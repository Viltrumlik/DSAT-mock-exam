"""Render every email template to disk with sample data, without sending anything.

Design iteration on an email is otherwise a slow loop: change a colour, send a real
message, wait for it to land, look at it on a phone. This renders the same HTML the
mail layer would attach, so the loop is a browser refresh.

    python manage.py preview_emails --open

The rendered files are throwaway; ``--out`` defaults to a gitignored directory.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

from django.core.management.base import BaseCommand
from django.template.loader import render_to_string

from core.mail import brand_context

# One entry per template, with context representative enough to catch layout bugs —
# long usernames wrap, a code with a leading zero must not lose it.
SAMPLES = [
    (
        "verification_code.html",
        {"code": "079431", "ttl_minutes": 15},
    ),
    (
        "midterm_scheduled.html",
        {
            "headline": "Your midterm is scheduled",
            "is_retake": False,
            # Long enough to prove the title wraps rather than stretching the shell.
            "midterm_title": "Reading & Writing Midterm 3 — Senior",
            "classroom_name": "ENG-Senior-Tue/Thu",
            "subject_label": "Reading & Writing",
            "question_label": "30 questions",
            "scoring_label": "Out of 800 · pass at 500",
            "month_label": "JUL",
            "day_number": "24",
            "weekday_label": "Thursday",
            "date_label": "24 July 2026",
            "start_time": "09:30",
            "end_time": "10:30",
            "duration_label": "60 minutes",
            "seated_by": "09:15",
            "timezone_label": "Asia/Tashkent",
            "midterm_url": "https://mastersat.uz/midterm",
        },
    ),
]


class Command(BaseCommand):
    help = "Render the email templates with sample data for visual review."

    # Every template the platform sends belongs in SAMPLES: a message that cannot be
    # previewed gets designed by sending real mail to a real class.

    def add_arguments(self, parser):
        parser.add_argument(
            "--out",
            default="email_previews",
            help="Directory to write the rendered HTML into (default: email_previews/).",
        )
        parser.add_argument(
            "--open",
            action="store_true",
            help="Open the rendered files in the default browser afterwards.",
        )
        parser.add_argument(
            "--site-url",
            default=None,
            help=(
                "Override EMAIL_SITE_URL so the logo resolves against a local server "
                "(e.g. http://localhost:8000) instead of production."
            ),
        )

    def handle(self, *args, **options):
        out_dir = pathlib.Path(options["out"])
        out_dir.mkdir(parents=True, exist_ok=True)

        written = []
        for template, sample in SAMPLES:
            context = brand_context(**sample)
            if options["site_url"]:
                site = options["site_url"].rstrip("/")
                context["site_url"] = site
                context["login_url"] = f"{site}/login"
                context["logo_url"] = f"{site}/static/email/logo.png"

            path = out_dir / template
            path.write_text(render_to_string(f"email/{template}", context), encoding="utf-8")
            written.append(path)
            self.stdout.write(self.style.SUCCESS(f"rendered {path}"))

        if options["open"]:
            opener = "open" if sys.platform == "darwin" else "xdg-open"
            for path in written:
                subprocess.run([opener, str(path)], check=False)
