"""Ops payloads for group posts."""

from __future__ import annotations

import json

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers
from rest_framework.utils import html

from . import audience, render, schedule, services
from .models import GroupPost, GroupPostDelivery


def _signed(field):
    """Signed URL for a picture, or None. `.url` raises on an unset field — the house guard."""
    if not field:
        return None
    try:
        return field.url
    except ValueError:
        return None


class JsonListField(serializers.ListField):
    """A list that may also arrive as a JSON string: a multipart form can only carry strings,
    and a picture makes the form multipart."""

    def get_value(self, dictionary):
        if html.is_html_input(dictionary) and self.field_name in dictionary:
            raw = dictionary.get(self.field_name)
            if isinstance(raw, str):
                if not raw.strip():
                    return []
                try:
                    return json.loads(raw)
                except ValueError:
                    return raw  # to_internal_value refuses it with ListField's own message
        return super().get_value(dictionary)


class DeliverySerializer(serializers.ModelSerializer):
    class Meta:
        model = GroupPostDelivery
        fields = ["id", "chat_id", "group_names", "status", "error", "sent_at", "attempts"]


class PostSerializer(serializers.ModelSerializer):
    preview = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    event_id = serializers.SerializerMethodField()
    event_title = serializers.SerializerMethodField()
    audience_label = serializers.SerializerMethodField()
    #: Who the post reaches NOW (`audience.post_audience`): a reminder follows its event's
    #: current audience, so the console's count and label match what will be sent.
    subjects = serializers.SerializerMethodField()
    levels = serializers.SerializerMethodField()
    classroom_ids = serializers.SerializerMethodField()
    next_send_at = serializers.SerializerMethodField()
    last_run = serializers.SerializerMethodField()
    state = serializers.SerializerMethodField()

    class Meta:
        model = GroupPost
        fields = [
            "id", "kind", "text", "preview", "image_url", "button_text", "button_url",
            "subjects", "levels", "classroom_ids", "when", "send_at", "weekdays", "time_of_day",
            "is_paused", "deleted_at", "event_id", "event_title", "created_at",
            "audience_label", "next_send_at", "last_run", "state",
        ]

    def _now(self):
        return self.context.get("now") or timezone.now()

    def _last(self, obj):
        return services.last_run(obj, self.context.get("counts") or {})

    def get_preview(self, obj):
        rendered = render.render(obj, preview=True)
        return rendered.text if rendered else ""

    def get_image_url(self, obj):
        if obj.image:
            return _signed(obj.image)
        if obj.kind == GroupPost.KIND_EVENT_ANNOUNCE and obj.event_id:
            return _signed(obj.event.cover_image)
        return None

    def get_event_id(self, obj):
        return obj.event_id

    def get_event_title(self, obj):
        return obj.event.title if obj.event_id else ""

    def get_audience_label(self, obj):
        return audience.label(**audience.post_audience(obj))

    def get_subjects(self, obj):
        return audience.post_audience(obj)["subjects"]

    def get_levels(self, obj):
        return audience.post_audience(obj)["levels"]

    def get_classroom_ids(self, obj):
        return audience.post_audience(obj)["classroom_ids"]

    def get_next_send_at(self, obj):
        moment = schedule.next_at(obj, self._now())
        return moment.isoformat() if moment else None

    def get_last_run(self, obj):
        last = self._last(obj)
        return {**last, "run_on": last["run_on"].isoformat()} if last else None

    def get_state(self, obj):
        return services.post_state(obj, self._last(obj), self._now())


class PostWriteSerializer(serializers.ModelSerializer):
    image = serializers.ImageField(required=False, allow_null=True)
    subjects = JsonListField(child=serializers.ChoiceField(choices=audience.SUBJECTS), required=False)
    levels = JsonListField(child=serializers.ChoiceField(choices=audience.LEVELS), required=False)
    classroom_ids = JsonListField(child=serializers.IntegerField(min_value=1), required=False)
    weekdays = JsonListField(child=serializers.IntegerField(min_value=0, max_value=6), required=False)
    # Required to create a post, never defaulted: a forgotten field must not mean "now, to every
    # group". DRF skips required checks on a partial update, so an edit may leave it out.
    when = serializers.ChoiceField(
        choices=[GroupPost.WHEN_NOW, GroupPost.WHEN_ONCE, GroupPost.WHEN_WEEKLY],
        required=True,
        error_messages={"required": "Choose when it goes out."},
    )

    class Meta:
        model = GroupPost
        fields = [
            "text", "image", "button_text", "button_url", "subjects", "levels", "classroom_ids",
            "when", "send_at", "weekdays", "time_of_day",
        ]

    def validate_image(self, value):
        if value is None:
            return value
        max_b = int(getattr(settings, "TELEGRAM_POST_MAX_IMAGE_BYTES", 5 * 1024 * 1024))
        if int(getattr(value, "size", 0) or 0) > max_b:
            raise serializers.ValidationError(f"That picture is too large. Maximum is {max_b} bytes.")
        content_type = str(getattr(value, "content_type", "") or "").lower()
        if content_type and not content_type.startswith("image/"):
            raise serializers.ValidationError("That file isn't an image.")
        return value

    def validate(self, attrs):
        inst = self.instance
        # The same value twice is one value: a class picked twice must not read as "2 chosen
        # groups". The first occurrence keeps its place. `weekdays` is de-duplicated below.
        for field in ("subjects", "levels", "classroom_ids"):
            if field in attrs:
                attrs[field] = list(dict.fromkeys(attrs[field]))

        def current(field, default=None):
            if field in attrs:
                return attrs[field]
            return getattr(inst, field, default) if inst is not None else default

        text = (current("text") or "").strip()
        if not text:
            raise serializers.ValidationError({"text": "Write the message — it is all the groups will see."})
        if "text" in attrs:
            attrs["text"] = text
        has_image = bool(attrs["image"]) if "image" in attrs else bool(inst is not None and inst.image)
        limit = render.CAPTION_MAX if has_image else render.TEXT_MAX
        # Telegram counts UTF-16 code units, and so does the console's counter (`string.length`):
        # an emoji is 2, though Python's len() says 1.
        length = render.tg_len(text)
        if length > limit:
            where = " under a picture" if has_image else ""
            raise serializers.ValidationError(
                {"text": f"Telegram takes {limit} characters{where}; this is {length}."}
            )

        label = (current("button_text") or "").strip()
        link = (current("button_url") or "").strip()
        if bool(label) != bool(link):
            raise serializers.ValidationError({"button_url": "A button needs both a label and a link."})
        if link and not link.startswith("https://"):
            raise serializers.ValidationError({"button_url": "The link must start with https://."})

        ids = current("classroom_ids") or []
        if ids:
            known = {row["id"] for row in audience.picker_rows()}
            if set(ids) - known:
                raise serializers.ValidationError(
                    {"classroom_ids": "Some of those classes are not connected to Telegram any more."}
                )

        when = current("when", GroupPost.WHEN_NOW)
        if when == GroupPost.WHEN_ONCE:
            send_at = current("send_at")
            if not send_at or send_at <= timezone.now():
                raise serializers.ValidationError({"send_at": "Pick a time in the future."})
        if when == GroupPost.WHEN_WEEKLY:
            if not (current("weekdays") or []):
                raise serializers.ValidationError({"weekdays": "Pick at least one day."})
            if current("time_of_day") is None:
                raise serializers.ValidationError({"time_of_day": "Pick the time it goes out."})
            if "weekdays" in attrs:
                attrs["weekdays"] = sorted(set(attrs["weekdays"]))
        return attrs
