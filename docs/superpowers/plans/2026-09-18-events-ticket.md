# Event Ticket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signing up issues a ticket — a PNG the student downloads and shows at the door, carrying the event, its date, their name, a code and a QR of that code — and ops check it by scanning the QR with a phone camera or by typing the code.

**Architecture:** A code column on the registration row; a renderer built like the midterm certificates (an HTML template through headless Chromium, captured as a PNG instead of printed as a PDF) with a plain Pillow fallback; one student endpoint that returns the image; one ops endpoint that resolves a code; and two small ops surfaces — a code box on the events page and a check page the QR opens.

**Tech Stack:** Django 6.0.3 / DRF, Playwright + Chromium (already installed on prod for certificates), Pillow, `segno` (new, pure Python), Next.js 16 / React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-events-design.md` §6 and the ticket rows of §2, §7, §8, §9, §10, §12.

**Depends on:** `docs/superpowers/plans/2026-09-18-events.md` (PR 1) — the app, the models, the services, the API and the pages this extends. Do not start until PR 1 is merged, or rebase onto it.

## Global Constraints

Every constraint from PR 1's plan still applies (worktree, commit trailer, targeted tests only, no `"/api/` literal in `frontend/src`, OpenAPI regeneration, no `.as_view({...})`). Plus:

- **The code alphabet is `23456789ABCDEFGHJKMNPQRSTVWXYZ`** — eight characters, no `O`, `0`, `I`, `1`, `L` or `U`, because a person reads it off a phone screen and types it. Stored bare; the dash in `4K29-7XPD` is display only; every lookup normalises case, spaces and dashes.
- **`OPS_SITE_URL`**, a new setting, default `https://admin.mastersat.uz`: the ops console host, because the host guard only allows the ops pages' API calls there. The QR points at it.
- **Chromium is the primary renderer and Pillow is the fallback.** Prod has Chromium (249 certificates rendered in a fortnight, no fallback warnings, checked 2026-09-18); **CI does not** — the backend workflow installs `requirements.txt` and nothing else. So no test may call the real renderer.
- **The ticket is a convenience, never the record.** Every rule it touches is enforced elsewhere: the code resolves a registration, and marking still goes through `services.mark_attendance`.

## File Structure

**Backend**

| File | Responsibility |
|---|---|
| `backend/events/models.py` (edit) | `EventRegistration.ticket_code` |
| `backend/events/migrations/0002_ticket_code.py` | add nullable → backfill → unique |
| `backend/events/services.py` (edit) | `new_ticket_code()`, `format_ticket_code()`, `find_by_ticket_code()`, the code minted on sign-up |
| `backend/events/ticket.py` | context → HTML → Chromium PNG, with the Pillow fallback |
| `backend/events/templates/events/ticket.html` | the card, self-contained |
| `backend/events/views.py` (edit) | `EventTicketView`, `AdminTicketLookupView` |
| `backend/events/urls.py` (edit) | their routes |
| `backend/events/serializers.py` (edit) | `ticket_code` on the student's own registration |
| `backend/config/settings.py` (edit) | `OPS_SITE_URL` |
| `backend/requirements.txt` (edit) | `segno` |
| `backend/events/tests_ticket.py` | the code, the lookup, the endpoints, the fallback |

**Frontend**

| File | Responsibility |
|---|---|
| `src/features/events/eventsApi.ts` (edit) | `ticketBlob(id)`, `adminTicket(code)` |
| `src/features/events/eventsHooks.ts` (edit) | `useTicketDownload()`, `useTicket(code)` |
| `src/features/events/EventsPage.tsx` (edit) | Download ticket + the code under it |
| `src/app/(ops)/ops/events/page.tsx` (edit) | the ticket-code box |
| `src/app/(ops)/ops/events/check/[code]/page.tsx` | what the QR opens |
| `src/features/events/__tests__/*` | vitest |

---

### Task 1: The code on the ticket

**Files:**
- Modify: `backend/events/models.py`, `backend/events/services.py`, `backend/events/serializers.py`
- Create: `backend/events/migrations/0002_ticket_code.py`, `backend/events/tests_ticket.py`

**Interfaces:**
- Produces:
  - `EventRegistration.ticket_code: str` (unique, 10 chars, written on create)
  - `events.services.TICKET_ALPHABET`, `new_ticket_code() -> str`, `format_ticket_code(code) -> str`, `find_by_ticket_code(code) -> EventRegistration | None`
  - `my_registration.ticket_code` in the student payload

- [ ] **Step 1: Write the failing test**

Create `backend/events/tests_ticket.py`:

```python
"""The ticket: its code, and the lookup the door runs on."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from access import constants as C
from events import services
from events.models import Event, EventRegistration

User = get_user_model()


class TicketFixture(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("tk_ops@t.com", "secret123", role=C.ROLE_ADMIN)
        self.anna = User.objects.create_user(
            "tk_anna@t.com", "secret123", role=C.ROLE_STUDENT,
            first_name="Anna", last_name="Karimova",
        )
        self.now = timezone.now()
        self.event = Event.objects.create(
            title="Robotics open day",
            starts_at=self.now + timedelta(days=2),
            ends_at=self.now + timedelta(days=2, hours=2),
            location="Fergana city branch, room 3",
            seats=30,
            status=Event.STATUS_PUBLISHED,
            published_at=self.now - timedelta(days=1),
            created_by=self.staff,
        )
        self.row = services.sign_up(self.event, self.anna, now=self.now)


class TicketCodeTests(TicketFixture):
    def test_signing_up_mints_a_code(self):
        self.assertEqual(len(self.row.ticket_code), 8)

    def test_the_code_carries_no_letter_anybody_could_misread(self):
        # No O/0, I/1, L or U: it is read off a phone screen and typed by hand.
        self.assertFalse(set(self.row.ticket_code) & set("O0I1LU"))

    def test_every_code_is_its_own(self):
        boris = User.objects.create_user("tk_boris@t.com", "secret123", role=C.ROLE_STUDENT)
        other = services.sign_up(self.event, boris, now=self.now)

        self.assertNotEqual(self.row.ticket_code, other.ticket_code)

    def test_cancelling_and_signing_up_again_keeps_one_code(self):
        code = self.row.ticket_code
        services.cancel_registration(self.row, now=self.now)

        again = services.sign_up(self.event, self.anna, now=self.now)

        self.assertEqual(again.ticket_code, code)

    def test_it_is_shown_with_a_dash_and_read_without_one(self):
        pretty = services.format_ticket_code(self.row.ticket_code)

        self.assertEqual(pretty, f"{self.row.ticket_code[:4]}-{self.row.ticket_code[4:]}")


class TicketLookupTests(TicketFixture):
    def test_the_code_finds_the_seat(self):
        found = services.find_by_ticket_code(self.row.ticket_code)

        self.assertEqual(found.pk, self.row.pk)

    def test_dashes_spaces_and_lower_case_all_work(self):
        code = self.row.ticket_code
        spelled = f" {code[:4].lower()}-{code[4:].lower()} "

        self.assertEqual(services.find_by_ticket_code(spelled).pk, self.row.pk)

    def test_an_unknown_code_finds_nothing(self):
        self.assertIsNone(services.find_by_ticket_code("2222-2222"))

    def test_an_empty_code_finds_nothing_rather_than_the_first_row(self):
        for value in ("", None, "   "):
            with self.subTest(value):
                self.assertIsNone(services.find_by_ticket_code(value))
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/macbook/Projects/dsat-wt-events/backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test events.tests_ticket --settings=config.settings_test_nomigrations -v 1
```
Expected: `AttributeError: 'EventRegistration' object has no attribute 'ticket_code'`.

- [ ] **Step 3: Add the column and the helpers**

In `backend/events/models.py`, on `EventRegistration`, under `status`:

```python
    #: What the student shows at the door. Minted once, on the row's creation, and kept for
    #: its life — a student who cancels and signs up again keeps one identity at the door and
    #: one in the ledger. Stored bare; the dash in "4K29-7XPD" is display only.
    ticket_code = models.CharField(
        max_length=10, unique=True, db_index=True, null=True, blank=True
    )
```

In `backend/events/services.py`:

```python
import secrets

#: No O/0, I/1, L or U. The code is read off a phone screen at a door and typed by hand, and
#: every one of those pairs is a support call waiting to happen.
TICKET_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
TICKET_LENGTH = 8


def new_ticket_code() -> str:
    """A code no ticket has yet. ~6.5 × 10¹¹ of them, drawn with `secrets`, not `random`."""
    for _ in range(12):
        code = "".join(secrets.choice(TICKET_ALPHABET) for _ in range(TICKET_LENGTH))
        if not EventRegistration.objects.filter(ticket_code=code).exists():
            return code
    # Twelve collisions in a row is not luck; it is a broken alphabet or a broken RNG.
    raise RuntimeError("could not mint an unused ticket code")


def format_ticket_code(code: str) -> str:
    """"4K297XPD" → "4K29-7XPD". Display only; nothing stores the dash."""
    code = (code or "").strip().upper()
    return f"{code[:4]}-{code[4:]}" if len(code) == TICKET_LENGTH else code


def find_by_ticket_code(code):
    """The one lookup behind both the scan and the typed box. Nothing for an unknown code."""
    cleaned = "".join(ch for ch in str(code or "").upper() if ch.isalnum())
    if len(cleaned) != TICKET_LENGTH:
        return None
    return (
        EventRegistration.objects.select_related("event", "student", "marked_by")
        .filter(ticket_code=cleaned)
        .first()
    )
```

and in `sign_up`, where the row is created:

```python
    if row is None:
        return EventRegistration.objects.create(
            event=event, student=student, ticket_code=new_ticket_code()
        )
```

In `backend/events/serializers.py`, add `ticket_code` to `EventRegistrationSerializer.Meta.fields` and give it the display form:

```python
    ticket_code = serializers.SerializerMethodField()

    def get_ticket_code(self, obj) -> str:
        from .services import format_ticket_code

        return format_ticket_code(obj.ticket_code) if obj.ticket_code else ""
```

- [ ] **Step 4: Write the migration**

```bash
cd /Users/macbook/Projects/dsat-wt-events/backend && SECRET_KEY=test-secret DEBUG=True python3 manage.py makemigrations events --name ticket_code
```
Then open `backend/events/migrations/0002_ticket_code.py` and put a backfill between the add and the unique index, so rows that already exist get a code:

```python
"""The ticket code, added to a table that already has rows.

Three steps in one file, and the order is the whole point: add it nullable, fill what is
there, and only then make it unique. One `AddField(unique=True)` fails the moment there is
more than one registration, because they would all start NULL.
"""

from django.db import migrations, models

ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
LENGTH = 8


def backfill(apps, schema_editor):
    import secrets

    EventRegistration = apps.get_model("events", "EventRegistration")
    taken = set(
        EventRegistration.objects.exclude(ticket_code=None).values_list("ticket_code", flat=True)
    )
    for row in EventRegistration.objects.filter(ticket_code=None).iterator():
        while True:
            code = "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))
            if code not in taken:
                break
        taken.add(code)
        EventRegistration.objects.filter(pk=row.pk).update(ticket_code=code)


def drop(apps, schema_editor):
    EventRegistration = apps.get_model("events", "EventRegistration")
    EventRegistration.objects.update(ticket_code=None)


class Migration(migrations.Migration):

    dependencies = [("events", "0001_initial")]

    operations = [
        # … the generated AddField for ticket_code (null=True, no unique yet) …
        migrations.RunPython(backfill, drop),
        migrations.AlterField(
            model_name="eventregistration",
            name="ticket_code",
            field=models.CharField(
                blank=True, db_index=True, max_length=10, null=True, unique=True
            ),
        ),
    ]
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd /Users/macbook/Projects/dsat-wt-events/backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test events.tests_ticket events.tests_signup --settings=config.settings_test_nomigrations -v 1
```
Expected: `OK` — the sign-up suite too, since `sign_up` changed.

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-events && git add backend/events && git commit -m "$(cat <<'EOF'
feat(events): a ticket code on every seat

Eight characters with no O/0, I/1, L or U, because it is read off a phone screen at a
door and typed by hand. Minted once and kept for the row's life, so cancelling and
signing up again keeps one identity at the door and one in the ledger. The migration
adds it nullable, backfills, and only then makes it unique.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Drawing the ticket

**Files:**
- Create: `backend/events/ticket.py`, `backend/events/templates/events/ticket.html`
- Modify: `backend/requirements.txt`, `backend/config/settings.py`
- Test: `backend/events/tests_ticket.py` (append)

**Interfaces:**
- Produces:
  - `events.ticket.build_context(registration) -> dict`
  - `events.ticket.qr_data_uri(url) -> str`, `events.ticket.check_url(code) -> str`
  - `events.ticket.render_html(registration) -> str`
  - `events.ticket.render_png(registration) -> bytes` (Chromium, falls back to Pillow)
  - `events.ticket.render_png_fallback(registration) -> bytes`
  - `settings.OPS_SITE_URL`

- [ ] **Step 1: Write the failing test (append to `backend/events/tests_ticket.py`)**

```python
class TicketRenderTests(TicketFixture):
    """The card's data and its fallback. The Chromium path is NOT exercised: CI has no
    browser, and the certificate suite already guards that renderer with a skipUnless."""

    def test_the_context_carries_what_the_door_needs(self):
        from events import ticket

        context = ticket.build_context(self.row)

        self.assertEqual(context["student_name"], "Anna Karimova")
        self.assertEqual(context["event_title"], "Robotics open day")
        self.assertEqual(context["location"], "Fergana city branch, room 3")
        self.assertEqual(
            context["ticket_code"], services.format_ticket_code(self.row.ticket_code)
        )
        self.assertIn(self.row.ticket_code, context["check_url"])

    def test_the_qr_points_at_the_ops_console_host(self):
        from django.test import override_settings

        from events import ticket

        with override_settings(OPS_SITE_URL="https://admin.example.test"):
            url = ticket.check_url(self.row.ticket_code)

        # The ops pages' API calls are only allowed on that host, so a QR aimed anywhere else
        # opens a page that 403s the moment it loads.
        self.assertTrue(url.startswith("https://admin.example.test/ops/events/check/"))

    def test_the_html_names_the_student_and_the_code(self):
        from events import ticket

        html = ticket.render_html(self.row)

        self.assertIn("Anna Karimova", html)
        self.assertIn(services.format_ticket_code(self.row.ticket_code), html)
        self.assertIn("data:image/svg+xml", html)  # the QR, inline

    def test_the_fallback_draws_a_real_png(self):
        from events import ticket

        data = ticket.render_png_fallback(self.row)

        self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertGreater(len(data), 2000)

    def test_a_broken_browser_falls_back_rather_than_failing_the_download(self):
        from unittest.mock import patch

        from events import ticket

        with patch.object(ticket, "_render_png_chromium", side_effect=RuntimeError("no browser")):
            data = ticket.render_png(self.row)

        self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/macbook/Projects/dsat-wt-events/backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test events.tests_ticket.TicketRenderTests --settings=config.settings_test_nomigrations -v 1
```
Expected: `ModuleNotFoundError: No module named 'events.ticket'`.

- [ ] **Step 3: Add the dependency and the setting**

`backend/requirements.txt`, after the certificate block:

```
# QR codes on event tickets. Pure Python, no system libraries — it writes the SVG that goes
# into the ticket template and the PNG the Pillow fallback pastes in.
segno==1.6.1
```
then `python3 -m pip install segno==1.6.1`.

`backend/config/settings.py`, beside `EMAIL_SITE_URL`:

```python
# Where the ops console lives. The QR on an event ticket points here, because `host_guard`
# only allows the ops pages' API calls on the admin host — a QR aimed at the apex opens a
# page that 403s the moment it loads. Set per environment; the default is production's.
OPS_SITE_URL = os.getenv('OPS_SITE_URL', 'https://admin.mastersat.uz')
```

- [ ] **Step 4: Write the renderer**

`backend/events/ticket.py`:

```python
"""The ticket a student shows at the door.

Rendered the way the pastpaper certificate is: a real Django template with real variables,
handed to headless Chromium through `set_content` and captured as a PNG. Not the midterm
certificates' technique — those inject data by walking text nodes for a placeholder name,
which exists only because those two template files cannot be edited.

Two deliberate choices:

* **A system font stack, no webfont.** Chromium on Linux rounds a webfont's advance widths
  and jams words together (see the --font-render-hinting note in certificate_html_pdf), and a
  ticket is mostly a code somebody has to read.
* **A Pillow fallback.** A ticket that will not open at the door is worse than a plain one.
  The certificates set this precedent with reportlab.
"""

from __future__ import annotations

import base64
import functools
import io
import logging
import os

import segno
from django.conf import settings
from django.template.loader import render_to_string
from django.utils import timezone

logger = logging.getLogger(__name__)

#: The flags the certificate renderer uses. `--no-sandbox` because the app runs as a
#: non-root user on the production box.
CHROMIUM_ARGS = ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"]

#: The card's native size, in CSS px. 2× device scale makes the capture sharp on a phone.
CARD_W, CARD_H = 720, 1020

ASSET_DIR = os.path.join(settings.BASE_DIR, "static", "certificates")


@functools.lru_cache(maxsize=4)
def _data_uri(filename: str) -> str:
    """A PNG as a base64 data URI, or "" when the asset is missing.

    Inlined because the page is handed to Chromium via `set_content` and has no base URL to
    resolve a relative path against. A missing logo still prints a usable ticket.
    """
    path = os.path.join(ASSET_DIR, filename)
    try:
        with open(path, "rb") as handle:
            return "data:image/png;base64," + base64.b64encode(handle.read()).decode("ascii")
    except OSError:
        logger.warning("ticket_asset_missing %s", path)
        return ""


def check_url(code: str) -> str:
    """Where the QR sends whoever scans it: the ops console's own host."""
    site = str(getattr(settings, "OPS_SITE_URL", "https://admin.mastersat.uz")).rstrip("/")
    return f"{site}/ops/events/check/{(code or '').strip().upper()}"


def qr_data_uri(url: str) -> str:
    """The QR as an inline SVG data URI. Error correction M: a ticket gets creased."""
    return segno.make(url, error="m").svg_data_uri(scale=6, border=0, dark="#0f1729")


def build_context(registration) -> dict:
    from .services import format_ticket_code

    event = registration.event
    student = registration.student
    starts = timezone.localtime(event.starts_at)
    ends = timezone.localtime(event.ends_at)
    url = check_url(registration.ticket_code or "")
    full_name = (
        (student.get_full_name() or "").strip()
        or (getattr(student, "username", "") or "").strip()
        or "Student"
    )

    return {
        "student_name": full_name,
        "event_title": event.title,
        "location": (event.location or "").strip(),
        "weekday_label": starts.strftime("%A"),
        "date_label": starts.strftime("%d %B %Y").lstrip("0"),
        "start_time": starts.strftime("%H:%M"),
        "end_time": ends.strftime("%H:%M"),
        "ticket_code": format_ticket_code(registration.ticket_code or ""),
        "check_url": url,
        "qr": qr_data_uri(url),
        "logo": _data_uri("shield_navy.png"),
        "card_w": CARD_W,
        "card_h": CARD_H,
    }


def render_html(registration) -> str:
    # Lives under `events/templates/` so APP_DIRS finds it by name.
    return render_to_string("events/ticket.html", build_context(registration))


def _render_png_chromium(registration) -> bytes:
    from playwright.sync_api import sync_playwright

    html = render_html(registration)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=CHROMIUM_ARGS)
        try:
            page = browser.new_page(
                viewport={"width": CARD_W, "height": CARD_H}, device_scale_factor=2
            )
            page.set_content(html, wait_until="load")
            card = page.query_selector("#ticket")
            if card is None:  # pragma: no cover - the template always carries it
                raise RuntimeError("ticket card not found in the rendered page")
            return card.screenshot(type="png")
        finally:
            browser.close()


def render_png_fallback(registration) -> bytes:
    """A plain card with the same facts, drawn with Pillow.

    No TTF ships in this repo, so the text uses Pillow's own bundled default at a readable
    size. It is not the designed ticket; it is a ticket that opens.
    """
    from PIL import Image, ImageDraw, ImageFont

    context = build_context(registration)
    image = Image.new("RGB", (CARD_W, CARD_H), "#ffffff")
    draw = ImageDraw.Draw(image)

    def font(size: int):
        return ImageFont.load_default(size=size)

    draw.rectangle([0, 0, CARD_W, 140], fill="#2a68c0")
    draw.text((40, 52), "MasterSAT · EVENT TICKET", font=font(28), fill="#ffffff")

    y = 190
    for text, size, colour in (
        (context["event_title"], 40, "#0f1729"),
        (f"{context['weekday_label']} {context['date_label']}", 26, "#334155"),
        (f"{context['start_time']}–{context['end_time']}", 26, "#334155"),
        (context["location"], 24, "#334155"),
        (context["student_name"], 34, "#0f1729"),
    ):
        if text:
            draw.text((40, y), text, font=font(size), fill=colour)
        y += size + 22

    qr_png = io.BytesIO()
    segno.make(context["check_url"], error="m").save(qr_png, kind="png", scale=8, border=1)
    qr_png.seek(0)
    qr = Image.open(qr_png).convert("RGB").resize((320, 320))
    image.paste(qr, ((CARD_W - 320) // 2, y + 40))

    draw.text((40, y + 400), context["ticket_code"], font=font(56), fill="#0f1729")
    draw.text((40, y + 480), "Show this at the door.", font=font(24), fill="#64748b")

    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def render_png(registration) -> bytes:
    """PNG bytes for one ticket. Chromium, falling back to Pillow on any browser problem."""
    try:
        return _render_png_chromium(registration)
    except Exception:  # noqa: BLE001 — any playwright/chromium issue → the plain card
        logger.exception(
            "ticket_render_failed registration=%s; falling back to Pillow", registration.pk
        )
        return render_png_fallback(registration)
```

`backend/events/templates/events/ticket.html`:

```html
{% comment %}
The event ticket, captured as a PNG by headless Chromium (events/ticket.py).

A system font stack, not a webfont: Chromium on Linux rounds a webfont's advance widths and
jams words together, and this card is mostly a code somebody has to read at a door. The QR
and the logo are inline data URIs, because the page is handed over via set_content and has no
base URL to resolve anything against.
{% endcomment %}
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: {{ card_w }}px; height: {{ card_h }}px; background: #eef3fb;
    font-family: "Helvetica Neue", "Segoe UI", Arial, sans-serif;
    -webkit-print-color-adjust: exact;
  }
  #ticket { width: {{ card_w }}px; height: {{ card_h }}px; background: #ffffff; display: flex; flex-direction: column; }
  .band { background: linear-gradient(160deg, #2a68c0, #1f4d9a); color: #fff; padding: 30px 40px; display: flex; align-items: center; gap: 14px; }
  .band img { width: 42px; height: auto; }
  .brand { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
  .eyebrow { font-size: 12px; font-weight: 800; letter-spacing: 0.14em; opacity: 0.85; }
  .body { padding: 36px 40px 0; flex: 1; }
  .title { font-size: 36px; font-weight: 800; color: #0f1729; line-height: 1.15; }
  .meta { margin-top: 14px; font-size: 19px; font-weight: 600; color: #334155; line-height: 1.5; }
  .who { margin-top: 26px; padding-top: 22px; border-top: 1px solid #e7ebf3; }
  .label { font-size: 12px; font-weight: 800; letter-spacing: 0.14em; color: #2a68c0; }
  .name { margin-top: 6px; font-size: 30px; font-weight: 800; color: #0f1729; }
  .codeblock { margin-top: 26px; display: flex; align-items: center; gap: 24px; }
  .code { font-size: 46px; font-weight: 800; letter-spacing: 0.08em; color: #0f1729; font-variant-numeric: tabular-nums; }
  .qr { width: 220px; height: 220px; }
  .foot { padding: 24px 40px 30px; font-size: 16px; font-weight: 700; color: #64748b; }
</style>
</head>
<body>
  <div id="ticket">
    <div class="band">
      {% if logo %}<img src="{{ logo }}" alt="" />{% endif %}
      <div>
        <div class="brand">MasterSAT</div>
        <div class="eyebrow">EVENT TICKET</div>
      </div>
    </div>

    <div class="body">
      <div class="title">{{ event_title }}</div>
      <div class="meta">
        {{ weekday_label }} {{ date_label }}<br />
        {{ start_time }}&ndash;{{ end_time }}{% if location %}<br />{{ location }}{% endif %}
      </div>

      <div class="who">
        <div class="label">TICKET HOLDER</div>
        <div class="name">{{ student_name }}</div>
      </div>

      <div class="codeblock">
        <div>
          <div class="label">CODE</div>
          <div class="code">{{ ticket_code }}</div>
        </div>
        <img class="qr" src="{{ qr }}" alt="" />
      </div>
    </div>

    <div class="foot">Show this at the door.</div>
  </div>
</body>
</html>
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd /Users/macbook/Projects/dsat-wt-events/backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test events.tests_ticket --settings=config.settings_test_nomigrations -v 1
```
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-events && git add backend && git commit -m "$(cat <<'EOF'
feat(events): draw the ticket — Chromium for the card, Pillow so the door never fails

A real Django template through set_content and a PNG capture, the pastpaper certificate's
technique rather than the midterm one's text-node injection. The QR points at the ops
console host, because that is the only host where the page it opens can call the API.
segno writes it; no system libraries.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Handing the ticket over, and reading it back

**Files:**
- Modify: `backend/events/views.py`, `backend/events/urls.py`
- Test: `backend/events/tests_ticket.py` (append)

**Interfaces:**
- Produces:
  - `GET /api/events/<id>/ticket.png` — the caller's own ticket, `image/png`, as an attachment
  - `GET /api/events/admin/tickets/<code>/` — `{registration_id, ticket_code, student_name, status, attendance, marked_at, marked_by_name, can_mark, reason, marking_opens_at, event}`

- [ ] **Step 1: Write the failing test (append)**

```python
class TicketEndpointTests(TicketFixture):
    def setUp(self):
        super().setUp()
        from rest_framework.test import APIClient

        self.client = APIClient()
        self.boris = User.objects.create_user("tk_boris2@t.com", "secret123", role=C.ROLE_STUDENT)

    def _as(self, user):
        self.client.force_authenticate(user)
        return self.client

    def test_a_student_downloads_their_own_ticket(self):
        from unittest.mock import patch

        from events import ticket

        with patch.object(ticket, "render_png", return_value=b"\x89PNG\r\n\x1a\nstub"):
            response = self._as(self.anna).get(f"/api/events/{self.event.id}/ticket.png")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertIn("attachment", response["Content-Disposition"])

    def test_somebody_else_s_ticket_is_404(self):
        self.assertEqual(
            self._as(self.boris).get(f"/api/events/{self.event.id}/ticket.png").status_code, 404
        )

    def test_a_cancelled_seat_has_no_ticket(self):
        services.cancel_registration(self.row, now=self.now)

        self.assertEqual(
            self._as(self.anna).get(f"/api/events/{self.event.id}/ticket.png").status_code, 404
        )


class OpsTicketLookupTests(TicketFixture):
    def setUp(self):
        super().setUp()
        from rest_framework.test import APIClient

        self.client = APIClient()
        self.code = services.format_ticket_code(self.row.ticket_code)

    def _as(self, user):
        self.client.force_authenticate(user)
        return self.client

    def _lookup(self, user, code=None):
        return self._as(user).get(f"/api/events/admin/tickets/{code or self.code}/")

    def test_a_student_cannot_resolve_a_code(self):
        # A stranger who scans a ticket meets the sign-in screen, not a name.
        self.assertEqual(self._lookup(self.anna).status_code, 403)

    def test_staff_get_the_name_and_the_event(self):
        body = self._lookup(self.staff).json()

        self.assertEqual(body["student_name"], "Anna Karimova")
        self.assertEqual(body["event"]["id"], self.event.id)
        self.assertEqual(body["registration_id"], self.row.id)

    def test_it_says_when_marking_is_still_too_early_and_why(self):
        body = self._lookup(self.staff).json()

        self.assertFalse(body["can_mark"])
        self.assertEqual(body["reason"], "too_early")

    def test_a_cancelled_seat_says_so(self):
        services.cancel_registration(self.row, now=self.now)

        body = self._lookup(self.staff).json()

        self.assertEqual((body["can_mark"], body["reason"]), (False, "cancelled"))

    def test_an_unknown_code_is_404(self):
        self.assertEqual(self._lookup(self.staff, code="2222-2222").status_code, 404)

    def test_a_marked_ticket_reports_who_marked_it_and_when(self):
        services.mark_attendance(
            self.row,
            EventRegistration.ATTENDANCE_ATTENDED,
            actor=self.staff,
            now=self.event.starts_at,
        )

        body = self._lookup(self.staff).json()

        self.assertEqual(body["attendance"], EventRegistration.ATTENDANCE_ATTENDED)
        self.assertTrue(body["marked_at"])
        self.assertTrue(body["marked_by_name"])
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/macbook/Projects/dsat-wt-events/backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test events.tests_ticket.TicketEndpointTests events.tests_ticket.OpsTicketLookupTests --settings=config.settings_test_nomigrations -v 1
```
Expected: 404s — neither route exists.

- [ ] **Step 3: Write the views**

Append to `backend/events/views.py` (and add `HttpResponse` to the `django.http` import):

```python
class EventTicketView(APIView):
    """The caller's own ticket for one event, as a PNG attachment.

    Behind the student's own session and keyed on the event, not on a registration id: the
    code is not a secret worth much, but a ticket carries somebody's name, and an endpoint
    that hands one over by id would hand over everybody's.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, event_id: int):
        from . import ticket as ticket_renderer

        row = (
            EventRegistration.objects.select_related("event", "student")
            .filter(
                event_id=event_id,
                student=request.user,
                status=EventRegistration.STATUS_REGISTERED,
                event__status=Event.STATUS_PUBLISHED,
            )
            .first()
        )
        if row is None or not row.ticket_code:
            raise Http404

        data = ticket_renderer.render_png(row)
        response = HttpResponse(data, content_type="image/png")
        response["Content-Disposition"] = (
            f'attachment; filename="mastersat-event-{row.ticket_code}.png"'
        )
        return response


class AdminTicketLookupView(_StaffView):
    """Resolve a ticket code: the scan and the typed box both land here.

    It answers `can_mark` WITH a reason rather than a bare boolean, because the desk needs to
    know which one — "too early" and "they gave the seat back" are different conversations
    with the student standing in front of them.
    """

    def get(self, request, code: str):
        denied = self._guard(request)
        if denied:
            return denied

        row = services.find_by_ticket_code(code)
        if row is None:
            raise Http404

        event = row.event
        now = timezone.now()
        if event.status == Event.STATUS_CANCELLED:
            can_mark, reason = False, "event_cancelled"
        elif row.status != EventRegistration.STATUS_REGISTERED:
            can_mark, reason = False, "cancelled"
        elif now < services.marking_opens_at(event):
            can_mark, reason = False, "too_early"
        else:
            can_mark, reason = True, ""

        marked_by = row.marked_by
        return Response({
            "registration_id": row.pk,
            "ticket_code": services.format_ticket_code(row.ticket_code or ""),
            "student_name": (row.student.get_full_name() or "").strip()
            or getattr(row.student, "username", "")
            or "Student",
            "status": row.status,
            "attendance": row.attendance,
            "marked_at": row.marked_at,
            "marked_by_name": (
                ((marked_by.get_full_name() or "").strip() or getattr(marked_by, "email", ""))
                if marked_by
                else ""
            ),
            "can_mark": can_mark,
            "reason": reason,
            "marking_opens_at": services.marking_opens_at(event),
            "event": {
                "id": event.pk,
                "title": event.title,
                "starts_at": event.starts_at,
                "ends_at": event.ends_at,
                "location": event.location,
                "status": event.status,
            },
        })
```

In `backend/events/urls.py`, add both — the admin one **above** the `<int:…>` block:

```python
    path(
        "admin/tickets/<str:code>/",
        AdminTicketLookupView.as_view(),
        name="events-admin-ticket",
    ),
```
```python
    path("<int:event_id>/ticket.png", EventTicketView.as_view(), name="events-ticket"),
```

- [ ] **Step 4: Run the whole app and watch it pass**

```bash
cd /Users/macbook/Projects/dsat-wt-events/backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test events --settings=config.settings_test_nomigrations -v 1
```
Expected: one `OK`.

- [ ] **Step 5: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-events && git add backend/events && git commit -m "$(cat <<'EOF'
feat(events): download your ticket, and resolve a code at the door

The ticket endpoint serves the caller's own seat only — a ticket carries somebody's
name. The lookup answers can_mark WITH a reason, because "too early" and "they gave
the seat back" are different conversations with a student standing in front of you.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Download ticket, on the student's page

**Files:**
- Modify: `frontend/src/features/events/eventsApi.ts`, `frontend/src/features/events/eventsHooks.ts`, `frontend/src/features/events/EventsPage.tsx`
- Test: `frontend/src/features/events/__tests__/EventsPage.test.tsx` (append)

**Interfaces:**
- Produces: `eventsApi.ticketBlob(id) -> Blob`, `useTicketDownload()`, a **Download ticket** button and the code under it.

- [ ] **Step 1: Write the failing test (append to `EventsPage.test.tsx`)**

At the top, extend the mock:

```tsx
const downloadTicket = vi.fn();
```
```tsx
  useTicketDownload: () => ({ mutate: downloadTicket, isPending: false }),
```

and extend the file's local `Row` type, whose `my_registration` was written before the code
existed — leave it and the new cases fail to compile:

```tsx
  my_registration: null | {
    id: number;
    status: string;
    attendance: string | null;
    registered_at: string;
    points_awarded: number;
    ticket_code: string;
  };
```
Every existing fixture in that file passes `my_registration: null` or a full object, so add
`ticket_code: ""` to the ones that spell it out.

and add the cases:

```tsx
  it("offers the ticket, with its code, to a student holding a seat", async () => {
    useUpcomingEvents.mockReturnValue(
      query({
        data: [
          row({
            can_sign_up: false,
            can_cancel: true,
            my_registration: {
              id: 5, status: "REGISTERED", attendance: null,
              registered_at: "2026-09-20T10:00:00+05:00", points_awarded: 0,
              ticket_code: "4K29-7XPD",
            },
          }),
        ],
      }),
    );
    await render();
    expect(text()).toContain("4K29-7XPD");
    await act(async () => buttonLabelled("Download ticket")!.click());
    expect(downloadTicket).toHaveBeenCalledWith(1);
  });

  it("offers no ticket to somebody without a seat", async () => {
    await render();
    expect(buttonLabelled("Download ticket")).toBeUndefined();
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/macbook/Projects/dsat-wt-events/frontend && npx vitest run src/features/events/__tests__/EventsPage.test.tsx
```
Expected: `Cannot read properties of undefined (reading 'click')`.

- [ ] **Step 3: Fetch the PNG through the API layer and save it**

In `frontend/src/features/events/eventsApi.ts`, add the field to `EventSeat`:

```ts
  /** Shown as "4K29-7XPD". Empty on a row minted before this migration ran. */
  ticket_code: string;
```
and the call:

```ts
  /**
   * The ticket as a Blob.
   *
   * Fetched through the axios instance rather than linked with an `<a href>`: the endpoint is
   * behind the session, the instance owns the auth header and the refresh retry, and a
   * hand-written URL in a component is exactly what `check:api-layer` forbids.
   */
  async ticketBlob(id: number): Promise<Blob> {
    const { data } = await api.get<Blob>(`/events/${id}/ticket.png`, { responseType: "blob" });
    return data;
  },
```

In `frontend/src/features/events/eventsHooks.ts`:

```ts
/**
 * Download the ticket.
 *
 * A mutation rather than a query: it writes a file, it must not be cached, and it must not
 * run because a component mounted.
 */
export function useTicketDownload() {
  return useMutation({
    mutationFn: async (id: number) => {
      const blob = await eventsApi.ticketBlob(id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mastersat-event-${id}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoked on the next tick: revoking synchronously races the download in Safari.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  });
}
```

In `frontend/src/features/events/EventsPage.tsx`, inside `EventRow`, add the hook and render the button in **both** branches where the student holds a seat (the one that offers Cancel and the one where the window has closed):

```tsx
  const ticket = useTicketDownload();
```
```tsx
          <button
            type="button"
            onClick={() => ticket.mutate(row.id)}
            disabled={ticket.isPending}
            className="ds-ring inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-extrabold text-foreground"
          >
            <Ticket className="h-4 w-4 text-primary" aria-hidden />
            Download ticket
          </button>
          {seat?.ticket_code ? (
            <span className="text-xs font-bold tracking-widest text-muted-foreground">
              {seat.ticket_code}
            </span>
          ) : null}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd /Users/macbook/Projects/dsat-wt-events/frontend && npx vitest run src/features/events
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-events && git add frontend/src && git commit -m "$(cat <<'EOF'
feat(events): Download ticket, with the code beside it

Fetched through the axios instance and saved from a Blob rather than linked with a
bare href: the endpoint is behind the session, and a hand-written URL in a component
is what check:api-layer exists to stop.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The two ops surfaces — a code box, and the page the QR opens

**Files:**
- Modify: `frontend/src/features/events/eventsApi.ts`, `frontend/src/features/events/eventsHooks.ts`, `frontend/src/app/(ops)/ops/events/page.tsx`
- Create: `frontend/src/app/(ops)/ops/events/check/[code]/page.tsx`, `frontend/src/features/events/__tests__/OpsTicketCheck.test.tsx`

**Interfaces:**
- Produces: `eventsApi.adminTicket(code)`, `useTicket(code)`, the ticket-code box, and `/ops/events/check/<code>`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/events/__tests__/OpsTicketCheck.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The page a phone camera opens when it scans a ticket.
 *
 * It is used standing at a door with somebody waiting, so every refusal has to say which one
 * it is — "too early" and "they gave the seat back" are different conversations.
 */

const useTicket = vi.fn();
const mark = vi.fn();

vi.mock("@/features/events/eventsHooks", () => ({
  useTicket: (code: string) => useTicket(code),
  useMarkAttendance: () => ({ mutate: mark, isPending: false }),
}));

const CheckPage = (await import("@/app/(ops)/ops/events/check/[code]/page")).default;

function ticket(over: Record<string, unknown> = {}) {
  return {
    registration_id: 12,
    ticket_code: "4K29-7XPD",
    student_name: "Anna Karimova",
    status: "REGISTERED",
    attendance: null,
    marked_at: null,
    marked_by_name: "",
    can_mark: true,
    reason: "",
    marking_opens_at: "2026-09-25T13:00:00+05:00",
    event: {
      id: 1, title: "Robotics open day", starts_at: "2026-09-25T15:00:00+05:00",
      ends_at: "2026-09-25T17:00:00+05:00", location: "Fergana city branch, room 3",
      status: "PUBLISHED",
    },
    ...over,
  };
}

function query(over: Record<string, unknown> = {}) {
  return { data: undefined, isPending: false, isError: false, refetch: vi.fn(), ...over };
}

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";
const buttonLabelled = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<CheckPage params={Promise.resolve({ code: "4K297XPD" })} />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useTicket.mockReturnValue(query({ data: ticket() }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("ops ticket check", () => {
  it("names the student and the event, large enough to read at a door", async () => {
    await render();
    expect(text()).toContain("Anna Karimova");
    expect(text()).toContain("Robotics open day");
    expect(text()).toContain("4K29-7XPD");
  });

  it("marks them as attended", async () => {
    await render();
    await act(async () => buttonLabelled("Attended")!.click());
    expect(mark).toHaveBeenCalledWith(
      { id: 12, attendance: "ATTENDED" },
      expect.anything(),
    );
  });

  it("reports a ticket that has already been marked, and by whom", async () => {
    useTicket.mockReturnValue(
      query({
        data: ticket({
          attendance: "ATTENDED",
          marked_at: "2026-09-25T15:04:00+05:00",
          marked_by_name: "Dilnoza R.",
        }),
      }),
    );
    await render();
    expect(text()).toContain("Attended");
    expect(text()).toContain("Dilnoza R.");
  });

  it("says when marking opens rather than offering a button the server refuses", async () => {
    useTicket.mockReturnValue(query({ data: ticket({ can_mark: false, reason: "too_early" }) }));
    await render();
    expect(text()).toContain("You can mark from");
    expect(buttonLabelled("Attended")).toBeUndefined();
  });

  it("says the seat was given back", async () => {
    useTicket.mockReturnValue(
      query({ data: ticket({ can_mark: false, reason: "cancelled", status: "CANCELLED" }) }),
    );
    await render();
    expect(text()).toContain("gave this seat back");
    expect(buttonLabelled("Attended")).toBeUndefined();
  });

  it("says a code it does not know is not a ticket", async () => {
    useTicket.mockReturnValue(query({ isError: true }));
    await render();
    expect(text()).toContain("No ticket with that code");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/macbook/Projects/dsat-wt-events/frontend && npx vitest run src/features/events/__tests__/OpsTicketCheck.test.tsx
```
Expected: `Failed to resolve import "@/app/(ops)/ops/events/check/[code]/page"`.

- [ ] **Step 3: Add the API call and the hook**

`frontend/src/features/events/eventsApi.ts`:

```ts
export interface TicketLookup {
  registration_id: number;
  ticket_code: string;
  student_name: string;
  status: "REGISTERED" | "CANCELLED";
  attendance: Attendance;
  marked_at: string | null;
  marked_by_name: string;
  can_mark: boolean;
  /** "" when can_mark, else `cancelled` | `event_cancelled` | `too_early`. */
  reason: string;
  marking_opens_at: string;
  event: {
    id: number;
    title: string;
    starts_at: string;
    ends_at: string;
    location: string;
    status: EventStatus;
  };
}
```
```ts
  async adminTicket(code: string): Promise<TicketLookup> {
    const { data } = await api.get<TicketLookup>(
      `/events/admin/tickets/${encodeURIComponent(code)}/`,
    );
    return data;
  },
```

`frontend/src/features/events/eventsHooks.ts`:

```ts
export function useTicket(code: string) {
  return useQuery({
    queryKey: ["events", "ticket", code],
    queryFn: () => eventsApi.adminTicket(code),
    enabled: Boolean(code),
    // A door is where the same ticket gets scanned twice by mistake; a cached answer still
    // reading "not marked" would send somebody through the flow again.
    staleTime: 0,
    retry: false,
  });
}
```

- [ ] **Step 4: Write the check page and the code box**

`frontend/src/app/(ops)/ops/events/check/[code]/page.tsx`:

```tsx
"use client";

/**
 * /ops/events/check/<code> — what a phone camera opens when it scans a ticket.
 *
 * Written for one specific moment: somebody is standing at a door, in a queue, and the person
 * holding the phone has about two seconds. So it is a name, an event, one button — and, when
 * the button is not there, a sentence saying exactly why.
 *
 * There is no scanner of our own here. The camera app does the scanning and opens this URL;
 * shipping a QR-reading library would add a dependency and a camera permission to do what the
 * phone already does.
 */

import { use } from "react";
import { Check, X } from "lucide-react";

import { Alert, Button } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { useMarkAttendance, useTicket } from "@/features/events/eventsHooks";

function fmtTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function TicketCheckPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const ticket = useTicket(code);
  const mark = useMarkAttendance(ticket.data?.event.id ?? 0);
  const row = ticket.data;

  return (
    <div className="space-y-5">
      <OpsPageHeader section="Events" title="Ticket" description="Scanned at the door." />

      {ticket.isPending ? (
        <p className="text-sm text-muted-foreground">Reading the ticket…</p>
      ) : ticket.isError || !row ? (
        <Alert tone="danger">
          No ticket with that code. Find the student by name in the list instead.
        </Alert>
      ) : (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
              {row.ticket_code}
            </p>
            <h2 className="text-2xl font-extrabold tracking-tight text-foreground">
              {row.student_name}
            </h2>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">
              {row.event.title}
              {row.event.location ? ` · ${row.event.location}` : ""}
            </p>
          </div>

          {row.attendance ? (
            <Alert tone={row.attendance === "ATTENDED" ? "success" : "info"}>
              {row.attendance === "ATTENDED" ? "Attended" : "Missed"}
              {row.marked_at ? ` · marked ${fmtTime(row.marked_at)}` : ""}
              {row.marked_by_name ? ` by ${row.marked_by_name}` : ""}
            </Alert>
          ) : null}

          {row.can_mark ? (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  mark.mutate(
                    { id: row.registration_id, attendance: "ATTENDED" },
                    { onSuccess: () => void ticket.refetch() },
                  )
                }
                loading={mark.isPending}
              >
                <Check className="mr-1.5 h-4 w-4" aria-hidden />
                Attended
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  mark.mutate(
                    { id: row.registration_id, attendance: "MISSED" },
                    { onSuccess: () => void ticket.refetch() },
                  )
                }
                loading={mark.isPending}
              >
                <X className="mr-1.5 h-4 w-4" aria-hidden />
                Missed
              </Button>
            </div>
          ) : row.reason === "too_early" ? (
            <Alert tone="info">You can mark from {fmtTime(row.marking_opens_at)}.</Alert>
          ) : row.reason === "cancelled" ? (
            <Alert tone="warning">
              This student gave this seat back, so there is nothing to mark.
            </Alert>
          ) : (
            <Alert tone="warning">This event was called off.</Alert>
          )}
        </div>
      )}
    </div>
  );
}
```

In `frontend/src/app/(ops)/ops/events/page.tsx`, inside `AttendancePanel`, add the typed box above the list — the same lookup, for a phone that will not scan:

```tsx
  const [typed, setTyped] = useState("");
  const cleaned = typed.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const matches = (list.data?.registrations ?? []).filter((r) =>
    cleaned.length >= 4 ? (r.ticket_code ?? "").replace("-", "").includes(cleaned) : true,
  );
```
```tsx
          <Field label="Ticket code" hint="Type or paste it — dashes and case don't matter.">
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="4K29-7XPD"
            />
          </Field>
```
and render `matches` instead of the full list. `AdminRegistrationSerializer` gained
`ticket_code` in Task 1; if the ops payload does not carry it, add it there beside `phone`, and
add the field to the `AdminRegistration` interface in `eventsApi.ts`.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
cd /Users/macbook/Projects/dsat-wt-events/frontend && npx vitest run src/features/events
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/macbook/Projects/dsat-wt-events && git add frontend/src && git commit -m "$(cat <<'EOF'
feat(events): the page the QR opens, and a typed code box beside the list

Written for a person at a door with a queue behind them: a name, an event, one
button — and when the button is not there, the sentence saying exactly why. No
scanner of our own: the camera app opens the URL, which is what it is for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The gates, the proof, and the PR

- [ ] **Step 1: Regenerate the OpenAPI artefacts**

```bash
cd /Users/macbook/Projects/dsat-wt-events/frontend && npm run gen:openapi && npm run gen:openapi-client && cd .. && git status --short
```
Commit the diff — it now carries the ticket endpoint and the lookup.

- [ ] **Step 2: Run every gate**

```bash
cd /Users/macbook/Projects/dsat-wt-events/frontend && npm run lint && npm run deadcode && npm run check:api-layer && npx vitest run src/features/events && npx next build --webpack
```
then the backend:
```bash
cd /Users/macbook/Projects/dsat-wt-events/backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test events --settings=config.settings_test_nomigrations -v 1
```
Expected: every gate clean, and `OK`.

- [ ] **Step 3: Rehearse the migration on rows that already exist**

The backfill runs over live data, so meet it here rather than on prod. Create a few
registrations through the dev server, then:

```bash
cd /Users/macbook/Projects/dsat-wt-events/backend && SECRET_KEY=test-secret DEBUG=True python3 manage.py migrate events && SECRET_KEY=test-secret DEBUG=True python3 manage.py shell -c "
from events.models import EventRegistration as R
codes = list(R.objects.values_list('ticket_code', flat=True))
print('rows', len(codes), 'blank', sum(1 for c in codes if not c), 'unique', len(set(codes)))
"
```
Expected: `blank 0`, and `unique` equal to `rows`.

- [ ] **Step 4: Look at a real ticket, and scan it with a real phone**

Render both cards — the designed one through Chromium and the fallback (force it by patching
`_render_png_chromium` in a shell) — and open the PNGs. Both must be legible at phone size.
Then scan the QR with an actual phone: it must open `/ops/events/check/<code>` on the admin
host and, once signed in there, show the student's name and the Attended button.

Capture for the PR: the ticket PNG, the check page marked and unmarked, the code box, and
`/events` showing Download ticket with the code.

- [ ] **Step 5: Open the PR**

```bash
cd /Users/macbook/Projects/dsat-wt-events && git push origin HEAD:refs/heads/feat/events-ticket && gh pr create --base feat/events --title "feat(events): the ticket — a PNG with a code and a QR the door checks" --body "$(cat <<'EOF'
PR 2 of the events spec: `docs/superpowers/specs/2026-09-17-events-design.md` §6. Stacked on
`feat/events` — merge that first.

**Student:** signing up now issues a ticket. `/events` offers **Download ticket** with the code
under it; the day-before reminder already points at that page.

**Ops:** scan the QR with any phone camera — it opens `/ops/events/check/<code>` on the admin
host, shows the student's name and one Attended button. Or type the code into the box beside
the list. Neither is required: the list still marks by name.

**The ticket:** MasterSAT band, the event, its date and place, the student's full name, an
eight-character code with no O/0 or I/1, and a QR of it. Drawn by Chromium from a Django
template, with a plain Pillow card as the fallback so a download never hard-fails.

**Migration:** `events.0002` — add `ticket_code` nullable, backfill the rows that exist, then
make it unique.

**New dependency:** `segno` (pure Python). **New setting:** `OPS_SITE_URL`, default
`https://admin.mastersat.uz` — a wrong value shows itself the first time a ticket is scanned,
so check one after the deploy.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Watch CI**

```bash
cd /Users/macbook/Projects/dsat-wt-events && gh pr checks --watch
```
Green, or fix and push. Do not merge — the owner decides when anything ships.

---

## Self-Review

Spec §6, line by line: the code's alphabet and length (Task 1); one code across a cancel and a
re-sign-up (Task 1); the normalised lookup (Task 1); the HTML-through-Chromium PNG with a
Pillow fallback (Task 2); what is printed on the card (Task 2); the QR pointing at
`OPS_SITE_URL` (Task 2); `segno` (Task 2); Download ticket on `/events` with the code (Task 4);
the reminder pointing at that page (already in PR 1); scan → check page → Attended (Task 5);
the typed box (Task 5); the list still marking by name (PR 1, untouched); the Code column
(PR 1's `AdminRegistrationSerializer`, verified in Task 5 Step 4).

Spec §9's ticket edge cases: 17, a ticket shown after cancelling → Task 3's `cancelled` reason
and Task 5's sentence; 18, the same ticket twice → Task 3's `marked_by_name`/`marked_at` and
Task 5's report, with the award already idempotent from PR 1; 19, no ticket at all → the list,
untouched; 20, no Chromium → Task 2's fallback, tested by patching the Chromium path.

One thing this plan decides that the spec left open: the student endpoint serves **only the
caller's own** ticket, keyed on the event rather than on a registration id, so no id can be
walked to somebody else's name.
