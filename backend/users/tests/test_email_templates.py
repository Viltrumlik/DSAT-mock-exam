"""Guards on the email shell itself, separate from the verification logic.

An email is rendered once and then lives in someone's inbox forever, unreachable by
any later fix. These assert the handful of properties that are invisible in a browser
preview but break the message in a real client.
"""
from __future__ import annotations

import re

from django.template.loader import render_to_string
from django.test import SimpleTestCase, override_settings

from core.mail import brand_context

MIDTERM_SAMPLE = {
    "headline": "Your midterm is scheduled",
    "is_retake": False,
    "midterm_title": "Reading & Writing Midterm 3",
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
}

TEMPLATES = {
    "email/verification_code.html": {"code": "079431", "ttl_minutes": 15},
    "email/midterm_scheduled.html": MIDTERM_SAMPLE,
}


class EmailShellTests(SimpleTestCase):
    def _render(self, template, sample, **ctx_overrides):
        context = brand_context(**sample)
        context.update(ctx_overrides)
        return render_to_string(template, context)

    def test_every_url_is_absolute(self):
        """A mail client has no origin, so a root-relative src or href is dead."""
        for template, sample in TEMPLATES.items():
            with self.subTest(template=template):
                html = self._render(template, sample)
                for attr, value in re.findall(r'(src|href)="([^"]+)"', html):
                    self.assertTrue(
                        value.startswith(("http://", "https://", "mailto:", "cid:")),
                        f"{template} has a non-absolute {attr}: {value!r}",
                    )

    def test_logo_url_follows_site_url(self):
        """Staging must not silently hotlink production's logo."""
        with override_settings(EMAIL_SITE_URL="https://staging.mastersat.uz"):
            html = self._render("email/verification_code.html", TEMPLATES["email/verification_code.html"])
        self.assertIn('src="https://staging.mastersat.uz/static/email/logo.png"', html)

    def test_logo_path_is_unhashed(self):
        """Manifest storage rewrites this asset's name on every change; a message sent
        last year still has to load it, so the src must stay the stable path."""
        html = self._render("email/verification_code.html", TEMPLATES["email/verification_code.html"])
        self.assertIn("/static/email/logo.png", html)
        self.assertNotRegex(html, r"/static/email/logo\.[0-9a-f]{8,}\.png")

    def test_each_message_sets_its_own_preheader(self):
        """Without one, the inbox snippet is scraped from the body and every message
        previews as the logo's alt text."""
        for template, sample in TEMPLATES.items():
            with self.subTest(template=template):
                html = self._render(template, sample)
                preheader = re.search(
                    r'<div style="display:none;[^"]*">(.*?)</div>', html, re.S
                )
                self.assertIsNotNone(preheader, f"{template} lost the preheader block")
                text = re.sub(r"&#\d+;|\s+", " ", preheader.group(1)).strip()
                self.assertTrue(text, f"{template} has an empty preheader")

    def test_code_is_not_split_across_elements(self):
        """Recipients copy the code. Any markup between the digits makes the paste
        arrive with stray whitespace and fail the exact-match check on confirm."""
        html = self._render("email/verification_code.html", {"code": "079431", "ttl_minutes": 15})
        self.assertRegex(html, r">\s*079431\s*<")

    def test_leading_zero_survives(self):
        """One code in ten starts with a zero; a numeric coercion anywhere eats it."""
        html = self._render("email/verification_code.html", {"code": "000123", "ttl_minutes": 15})
        self.assertIn("000123", html)

    def test_autoescape_is_on_in_the_shell(self):
        """The shell interpolates the site URL into both an href and a link label."""
        with override_settings(EMAIL_SITE_URL="https://x.uz/<script>alert(1)</script>"):
            html = self._render(
                "email/verification_code.html", TEMPLATES["email/verification_code.html"]
            )
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("&lt;script&gt;", html)

    def test_staff_authored_title_is_escaped(self):
        """The midterm title is the first user-supplied string to reach a template, and it
        lands in the body, the <title> and the inbox preheader. A staff account that turns
        one of those into markup has scripted every student's mail client."""
        html = self._render(
            "email/midterm_scheduled.html",
            {**MIDTERM_SAMPLE, "midterm_title": "<script>alert(1)</script>"},
        )
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)
