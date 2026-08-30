"""TEMP probe: can a super_admin clear a survey/question picture via /django-admin/?"""
from __future__ import annotations

import base64

from django.contrib import admin as dj_admin
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from surveys.models import Survey, SurveyQuestion

PNG = base64.b64decode(
    b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

User = get_user_model()


class AdminImageClearProbe(TestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(
            email="boss@example.com", password="x", role="super_admin"
        )
        User.objects.filter(pk=self.admin_user.pk).update(is_staff=True)
        self.admin_user.refresh_from_db()
        self.survey = Survey.objects.create(title="Trip poll", status=Survey.STATUS_DRAFT)
        self.survey.image.save("banner.png", SimpleUploadedFile("banner.png", PNG), save=True)
        self.q = SurveyQuestion.objects.create(
            survey=self.survey, order=0, prompt="Q3", question_type="SHORT_TEXT"
        )
        self.q.image.save("q3.png", SimpleUploadedFile("q3.png", PNG), save=True)

    def test_probe(self):
        ma = dj_admin.site._registry[Survey]
        print("ADMIN FORM FIELDS:", list(ma.get_form(None, obj=self.survey, change=True).base_fields))
        inline = ma.inlines[0](SurveyQuestion, dj_admin.site)
        fs = inline.get_formset(None, obj=self.survey)
        print("INLINE FORM FIELDS:", list(fs.form.base_fields))

        self.client.force_login(self.admin_user)
        url = reverse("admin:surveys_survey_change", args=[self.survey.pk])
        r = self.client.get(url)
        print("GET status:", r.status_code)
        html = r.content.decode()
        print("survey image-clear checkbox present:", 'name="image-clear"' in html)
        print("question image-clear checkbox present:", 'questions-0-image-clear' in html)

        # Build a full POST from the rendered forms, then tick both clear boxes.
        ctx = r.context[-1]
        adminform = ctx["adminform"]
        formsets = ctx["inline_admin_formsets"]
        data = {}
        for name, field in adminform.form.fields.items():
            bf = adminform.form[name]
            val = bf.value()
            if val is None or hasattr(val, "url"):
                data[name] = ""
            elif isinstance(val, bool):
                data[name] = "on" if val else ""
            elif isinstance(val, (list, tuple)):
                data[name] = val
            else:
                data[name] = str(val)
        fsw = formsets[0].formset
        data.update(fsw.management_form.initial)
        for k, v in fsw.management_form.initial.items():
            data[f"questions-{k}"] = v
        for i, form in enumerate(fsw.forms):
            for name, field in form.fields.items():
                bf = form[name]
                val = bf.value()
                if val is None or hasattr(val, "url"):
                    data[f"questions-{i}-{name}"] = ""
                elif isinstance(val, bool):
                    data[f"questions-{i}-{name}"] = "on" if val else ""
                else:
                    data[f"questions-{i}-{name}"] = str(val)
        data["image-clear"] = "on"
        data["questions-0-image-clear"] = "on"
        data["_continue"] = "Save and continue"

        resp = self.client.post(url, data)
        print("POST status:", resp.status_code)
        if resp.status_code == 200:
            ctx2 = resp.context[-1] if resp.context else None
            if ctx2:
                print("form errors:", ctx2["adminform"].form.errors)
                print("inline errors:", ctx2["inline_admin_formsets"][0].formset.errors)
        self.survey.refresh_from_db()
        self.q.refresh_from_db()
        print("survey.image after:", repr(self.survey.image.name))
        print("question.image after:", repr(self.q.image.name))
