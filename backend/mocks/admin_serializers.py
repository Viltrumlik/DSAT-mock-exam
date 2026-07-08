"""Admin/builder serializer for authoring full mocks."""

from __future__ import annotations

from rest_framework import serializers

from .models import Mock

READING_WRITING = "READING_WRITING"


def _all_modules(mock):
    for sec in mock.sections.all():
        for m in sec.modules():
            yield sec, m


def publish_check(mock):
    sections = list(mock.sections.all())
    if len(sections) != 2:
        return False, "A mock needs an English and a Math section."
    for _sec, m in _all_modules(mock):
        if not m.questions.exists():
            return False, "Every module needs at least one question."
    return True, ""


class AdminMockSerializer(serializers.ModelSerializer):
    sections = serializers.SerializerMethodField()
    question_count = serializers.SerializerMethodField()
    publish_ready = serializers.SerializerMethodField()
    publish_block_reason = serializers.SerializerMethodField()

    class Meta:
        model = Mock
        fields = [
            "id", "title", "break_minutes", "is_published", "published_at", "created_by", "created_at",
            "sections", "question_count", "publish_ready", "publish_block_reason",
        ]
        read_only_fields = [
            "is_published", "published_at", "created_by", "created_at",
            "sections", "question_count", "publish_ready", "publish_block_reason",
        ]

    def get_sections(self, obj):
        secs = sorted(obj.sections.all(), key=lambda s: 0 if s.subject == READING_WRITING else 1)
        out = []
        for s in secs:
            out.append({
                "subject": s.subject,
                "modules": [
                    {"id": m.id, "module_order": m.module_order, "time_limit_minutes": m.time_limit_minutes,
                     "question_count": m.questions.count()}
                    for m in s.modules()
                ],
            })
        return out

    def get_question_count(self, obj):
        return sum(m.questions.count() for _s, m in _all_modules(obj))

    def get_publish_ready(self, obj):
        return publish_check(obj)[0]

    def get_publish_block_reason(self, obj):
        return publish_check(obj)[1]
