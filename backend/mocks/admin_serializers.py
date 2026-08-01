"""Admin/builder serializer for authoring full mocks."""

from __future__ import annotations

from rest_framework import serializers

from exams.sat_rules import SAT_MODULE_QUESTION_COUNT

from .models import Mock

READING_WRITING = "READING_WRITING"


def _all_modules(mock):
    for sec in mock.sections.all():
        for m in sec.modules():
            yield sec, m


def _subject_label(subject):
    return "Reading & Writing" if subject == READING_WRITING else "Math"


def publish_check(mock):
    sections = list(mock.sections.all())
    if len(sections) != 2:
        return False, "A mock needs an English and a Math section."
    for _sec, m in _all_modules(mock):
        if not m.questions.exists():
            return False, "Every module needs at least one question."
    return True, ""


def publish_warnings(mock):
    """Non-blocking gaps between this mock and the official Digital SAT shape.

    Publishing a short mock is allowed — the scorer is proportional, so a 12-question module
    still lands on the 200–800 scale. But a mock that says "full SAT simulation" and hands a
    student 12 Reading questions instead of 27 is not the thing it claims to be, and nothing
    told the author. These surface the shortfall without standing in the way.
    """
    out = []
    for sec, m in _all_modules(mock):
        target = SAT_MODULE_QUESTION_COUNT.get(sec.subject)
        if not target:
            continue
        have = m.questions.count()
        if have < target:
            out.append(
                f"{_subject_label(sec.subject)} module {m.module_order} has {have} of "
                f"{target} questions."
            )
    return out


class AdminMockSerializer(serializers.ModelSerializer):
    sections = serializers.SerializerMethodField()
    question_count = serializers.SerializerMethodField()
    publish_ready = serializers.SerializerMethodField()
    publish_block_reason = serializers.SerializerMethodField()
    publish_warnings = serializers.SerializerMethodField()

    class Meta:
        model = Mock
        fields = [
            "id", "title", "break_minutes", "is_published", "published_at", "created_by", "created_at",
            "sections", "question_count", "publish_ready", "publish_block_reason", "publish_warnings",
        ]
        read_only_fields = [
            "is_published", "published_at", "created_by", "created_at",
            "sections", "question_count", "publish_ready", "publish_block_reason", "publish_warnings",
        ]

    def get_sections(self, obj):
        secs = sorted(obj.sections.all(), key=lambda s: 0 if s.subject == READING_WRITING else 1)
        out = []
        for s in secs:
            target = SAT_MODULE_QUESTION_COUNT.get(s.subject)
            out.append({
                "subject": s.subject,
                "modules": [
                    {"id": m.id, "module_order": m.module_order, "time_limit_minutes": m.time_limit_minutes,
                     "question_count": m.questions.count(),
                     # The official Digital SAT per-module count (27 R&W / 22 Math) — also the
                     # hard cap the editor and the CSV import enforce.
                     "question_target": target}
                    for m in s.modules()
                ],
            })
        return out

    def get_publish_warnings(self, obj):
        return publish_warnings(obj)

    def get_question_count(self, obj):
        return sum(m.questions.count() for _s, m in _all_modules(obj))

    def get_publish_ready(self, obj):
        return publish_check(obj)[0]

    def get_publish_block_reason(self, obj):
        return publish_check(obj)[1]
