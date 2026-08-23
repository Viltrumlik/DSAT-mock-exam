"""Print a fresh VAPID keypair for an operator to paste into their own environment.

**This command prints a secret and stores nothing.** That is the entire design. Push has been
dead in production since the day it was built for one reason — ``VAPID_PUBLIC_KEY`` and
``VAPID_PRIVATE_KEY`` default to ``""`` and nobody ever set them — and the obvious "fix" of
committing a generated pair would be much worse than the outage it cured: a VAPID private key
in git is a key that anybody with repository access, now or at any point in the history, can
use to send push notifications that browsers will accept as coming from this school. Git does
not forget, so a leaked key is leaked for the life of the repository, and the only remedy is
rotating it — which invalidates every subscription every student has ever granted.

So the keys are generated here, on the operator's terminal, printed once, and never written to
a file by this process. Where they go afterwards is the operator's decision and the
environment's problem, not the codebase's.

Usage::

    python manage.py generate_vapid_keys

Then paste the three lines it prints into ``shared/backend.env`` (mode 600) and restart
**both** ``sat-backend`` and ``sat-celery-worker`` — see ``deploy/README.md``. The Django
process serves the public key to the browser and the Celery worker signs the actual sends, so
a restart of only one of them leaves push half-configured.
"""

from __future__ import annotations

import base64

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


def _b64url(raw: bytes) -> str:
    """Base64url with the padding stripped — the encoding the Web Push spec uses.

    Not a stylistic choice: ``applicationServerKey`` is handed to
    ``PushManager.subscribe()`` in the browser, and the padding characters are not valid
    there. ``py_vapid`` reads the private half back in exactly this form too, so both halves
    can be plain env strings with no PEM file to deploy alongside them.
    """
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def generate_keypair() -> tuple[str, str]:
    """Return ``(public_key, private_key)`` as base64url strings.

    A P-256 (``secp256r1``) key, because that is the only curve Web Push permits. The public
    half is the *uncompressed point* — 65 bytes beginning with ``0x04`` — and the private half
    is the raw 32-byte scalar; those two encodings are what browsers and ``pywebpush``
    respectively expect, and a DER or PEM dump of the same key would be rejected by both.
    """
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
    except ImportError as exc:  # pragma: no cover - depends on the deployment's venv
        raise CommandError(
            "`cryptography` is not installed in this environment, so no key can be "
            "generated here. It ships with `pywebpush` in requirements.txt — install the "
            "backend requirements (or run this on the server's release venv) and try again."
        ) from exc

    key = ec.generate_private_key(ec.SECP256R1())
    private_raw = key.private_numbers().private_value.to_bytes(32, "big")
    public_raw = key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return _b64url(public_raw), _b64url(private_raw)


class Command(BaseCommand):
    help = (
        "Print a fresh VAPID keypair for Web Push. Prints a SECRET; stores nothing. "
        "Paste the output into your own environment file — never into a tracked file."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--subject",
            default="",
            help=(
                "The `mailto:` or https contact a push service uses to reach a human when "
                "this platform misbehaves. Required by the spec; some services refuse a "
                "subscription without one. Defaults to the current VAPID_SUBJECT setting."
            ),
        )

    def handle(self, *args, **options):
        subject = (options.get("subject") or "").strip() or (
            getattr(settings, "VAPID_SUBJECT", "") or "mailto:admin@mastersat.uz"
        )
        if not (subject.startswith("mailto:") or subject.startswith("https://")):
            raise CommandError(
                "VAPID_SUBJECT must be a `mailto:` address or an https URL — a push service "
                "may reject a subscription signed with anything else."
            )

        public_key, private_key = generate_keypair()

        already = bool(
            getattr(settings, "VAPID_PUBLIC_KEY", "")
            and getattr(settings, "VAPID_PRIVATE_KEY", "")
        )
        if already:
            # Loud, because replacing a live key silently invalidates every subscription every
            # student has already granted — and a browser permission, once refused or lapsed,
            # is not something the platform can ask for again on that origin.
            self.stderr.write(
                self.style.WARNING(
                    "WARNING: this deployment ALREADY has VAPID keys configured. Replacing "
                    "them invalidates every push subscription students have granted, and "
                    "their browsers will not re-ask on their own. Only rotate deliberately."
                )
            )

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("VAPID keypair (paste into your env):"))
        self.stdout.write("")
        self.stdout.write(f"VAPID_PUBLIC_KEY={public_key}")
        self.stdout.write(f"VAPID_PRIVATE_KEY={private_key}")
        self.stdout.write(f"VAPID_SUBJECT={subject}")
        self.stdout.write("")
        self.stderr.write(
            self.style.ERROR(
                "NEVER COMMIT THE PRIVATE KEY. Not to settings.py, not to deploy/, not to a "
                "sample .env, not to a ticket or a chat message. Anyone holding it can send "
                "push notifications that browsers accept as coming from this school, and git "
                "keeps it forever once it lands."
            )
        )
        self.stderr.write(
            self.style.WARNING(
                "Put these in shared/backend.env (chmod 600), then restart BOTH sat-backend "
                "and sat-celery-worker — the web process serves the public key and the worker "
                "signs the sends, and each reads settings only at start."
            )
        )
