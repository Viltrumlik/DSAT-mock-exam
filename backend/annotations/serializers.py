"""Validation for one region's annotation list.

The shapes mirror `frontend/.../highlight/annotations.ts`. The server does not interpret the
offsets — it cannot, they belong to a rendered DOM it never sees — but it does refuse
nonsense, because this table is written straight from the browser and a malformed row would
break the *next* read for that student rather than the write that caused it.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import StudyAnnotation

HIGHLIGHT_COLORS = {"yellow", "blue", "pink"}
UNDERLINE_STYLES = {"solid", "dashed"}

#: A generous ceiling, not a product rule. Someone highlighting an entire passage word by word
#: is plausible; ten thousand ranges on one paragraph is a runaway client.
MAX_RANGES_PER_CONTAINER = 500


class AnnotationRangeSerializer(serializers.Serializer):
    start = serializers.IntegerField(min_value=0)
    end = serializers.IntegerField(min_value=1)
    kind = serializers.ChoiceField(choices=["highlight", "underline"])
    color = serializers.CharField(required=False, allow_blank=True)
    underline = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["end"] <= attrs["start"]:
            raise serializers.ValidationError("end must be greater than start.")
        if attrs["kind"] == "highlight":
            color = attrs.get("color") or "yellow"
            if color not in HIGHLIGHT_COLORS:
                raise serializers.ValidationError(f"Unknown highlight colour {color!r}.")
            attrs["color"] = color
            attrs.pop("underline", None)
        else:
            underline = attrs.get("underline") or "solid"
            if underline not in UNDERLINE_STYLES:
                raise serializers.ValidationError(f"Unknown underline style {underline!r}.")
            attrs["underline"] = underline
            attrs.pop("color", None)
        return attrs


class AnnotationWriteSerializer(serializers.Serializer):
    scope = serializers.ChoiceField(choices=[c[0] for c in StudyAnnotation.SCOPE_CHOICES])
    ref = serializers.CharField(max_length=64)
    target_id = serializers.IntegerField(min_value=0)
    container = serializers.CharField(max_length=32)
    data = serializers.ListField(
        child=AnnotationRangeSerializer(), allow_empty=True, max_length=MAX_RANGES_PER_CONTAINER
    )
