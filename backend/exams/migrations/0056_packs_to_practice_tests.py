"""Detach every practice-test-pack section into a standalone practice test (owner 2026-10-15:
"practice test pastpaper kabi faqat bitta section bo'ladi").

A section that has questions and whose pack was published goes live as an Open, all-levels
practice test with the next number for its subject (packs in creation order). Everything else
becomes an unpublished draft. Nothing is deleted; the empty pack rows go in PR 3.
"""
from django.db import migrations
from django.db.models import Max
from django.utils import timezone


def forwards(apps, schema_editor):
    PracticeTestPack = apps.get_model("exams", "PracticeTestPack")
    PracticeTest = apps.get_model("exams", "PracticeTest")
    Question = apps.get_model("exams", "Question")

    next_number = {}
    for subject in ("READING_WRITING", "MATH"):
        top = (
            PracticeTest.objects.filter(is_practice_test=True, subject=subject)
            .aggregate(m=Max("practice_number"))["m"]
        )
        next_number[subject] = (top or 0) + 1

    now = timezone.now()
    for pack in PracticeTestPack.objects.order_by("created_at", "id"):
        for section in PracticeTest.objects.filter(practice_test_pack_id=pack.pk).order_by("subject", "id"):
            has_questions = Question.objects.filter(module__practice_test_id=section.pk).exists()
            live = bool(pack.is_published and has_questions)
            section.is_practice_test = True
            section.practice_test_pack_id = None
            section.practice_level = ""
            if live:
                section.practice_access = "open"
                section.is_published = True
                section.published_at = section.published_at or pack.published_at or now
                section.practice_number = next_number[section.subject]
                next_number[section.subject] += 1
            else:
                section.practice_access = "homework_only"
                section.is_published = False
            section.save(update_fields=[
                "is_practice_test", "practice_test_pack", "practice_level", "practice_access",
                "is_published", "published_at", "practice_number",
            ])


class Migration(migrations.Migration):

    dependencies = [
        ("exams", "0055_practice_test_fields"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
