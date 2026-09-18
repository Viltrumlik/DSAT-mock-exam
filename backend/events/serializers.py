"""What the API says about an event.

One read serializer for both surfaces, like `stories`. The student's own seat rides along in
`my_registration` rather than as a second request: every card needs it, and a second round
trip per card is what makes a list page feel broken on a phone.
"""

from __future__ import annotations

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from .models import Event, EventRegistration
from .services import CANCEL_CUTOFF


def _image_url(instance, request=None):
    """Signed URL for the cover, or None.

    The `ValueError` guard is the house pattern: `.url` on an unset FileField raises rather
    than returning None, and an event saved without a picture is allowed.
    """
    image = getattr(instance, "cover_image", None)
    if not image:
        return None
    try:
        url = image.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request and url.startswith("/") else url


class EventRegistrationSerializer(serializers.ModelSerializer):
    points_awarded = serializers.SerializerMethodField()
    ticket_code = serializers.SerializerMethodField()

    class Meta:
        model = EventRegistration
        fields = ["id", "status", "attendance", "registered_at", "points_awarded", "ticket_code"]

    def get_ticket_code(self, obj) -> str:
        from .services import format_ticket_code

        return format_ticket_code(obj.ticket_code) if obj.ticket_code else ""

    def get_points_awarded(self, obj) -> int:
        """What this seat has actually paid. Read from the ledger, never from the rule.

        A correction zeroes the award rather than deleting it, so this is 0 for a student
        marked Missed after being marked Attended — which is the honest number.
        """
        from rewards import constants as reward_const
        from rewards.models import PointAward

        row = PointAward.objects.filter(
            idempotency_key=reward_const.event_attendance_key(obj.pk)
        ).only("points").first()
        return int(row.points) if row else 0


class EventSerializer(serializers.ModelSerializer):
    cover_image_url = serializers.SerializerMethodField()
    seats_left = serializers.IntegerField(read_only=True)
    my_registration = serializers.SerializerMethodField()
    can_sign_up = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "id", "title", "description", "cover_image_url", "starts_at", "ends_at",
            "location", "seats", "seats_left", "status", "my_registration",
            "can_sign_up", "can_cancel",
        ]

    def _row(self, obj):
        return (self.context.get("my_rows") or {}).get(obj.pk)

    def get_cover_image_url(self, obj):
        return _image_url(obj, self.context.get("request"))

    def get_my_registration(self, obj):
        row = self._row(obj)
        return EventRegistrationSerializer(row).data if row else None

    def get_can_sign_up(self, obj) -> bool:
        row = self._row(obj)
        if row and row.status == EventRegistration.STATUS_REGISTERED:
            return False
        return (
            obj.status == Event.STATUS_PUBLISHED
            and obj.starts_at > timezone.now()
            and obj.seats_left > 0
        )

    def get_can_cancel(self, obj) -> bool:
        row = self._row(obj)
        if not row or row.status != EventRegistration.STATUS_REGISTERED:
            return False
        return timezone.now() < obj.starts_at - CANCEL_CUTOFF


class EventWriteSerializer(serializers.ModelSerializer):
    """Ops create/update. Multipart when a picture is attached, like `StoryWriteSerializer`."""

    cover_image = serializers.ImageField(required=False, allow_null=True)

    class Meta:
        model = Event
        fields = [
            "title", "description", "cover_image", "starts_at", "ends_at", "location", "seats",
        ]

    def validate_title(self, value):
        title = (value or "").strip()
        if not title:
            raise serializers.ValidationError("Give the event a name — students see it first.")
        return title

    def validate_seats(self, value):
        if int(value) < 1:
            raise serializers.ValidationError("An event needs at least one seat.")
        return value

    def validate_cover_image(self, value):
        """Same rule as the profile photo: an image, and not a phone original."""
        if value is None:
            return value
        max_b = int(getattr(settings, "EVENT_MAX_IMAGE_BYTES", 5 * 1024 * 1024))
        if int(getattr(value, "size", 0) or 0) > max_b:
            raise serializers.ValidationError(f"That picture is too large. Maximum is {max_b} bytes.")
        content_type = str(getattr(value, "content_type", "") or "").lower()
        if content_type and not content_type.startswith("image/"):
            raise serializers.ValidationError("That file isn't an image.")
        return value

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        starts_at = attrs.get("starts_at", getattr(instance, "starts_at", None))
        ends_at = attrs.get("ends_at", getattr(instance, "ends_at", None))
        if starts_at and ends_at and ends_at <= starts_at:
            raise serializers.ValidationError(
                {"ends_at": "The event would end before it started. Move the end time later."}
            )
        return attrs


class AdminRegistrationSerializer(serializers.ModelSerializer):
    """The attendance list. Names and a phone number, so the desk can find a person."""

    student_name = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()
    ticket_code = serializers.SerializerMethodField()

    class Meta:
        model = EventRegistration
        fields = [
            "id", "student", "student_name", "phone", "ticket_code", "status", "registered_at",
            "attendance", "marked_at",
        ]

    def get_student_name(self, obj) -> str:
        full = (obj.student.get_full_name() or "").strip()
        return full or (getattr(obj.student, "username", "") or "").strip() or "Student"

    def get_ticket_code(self, obj) -> str:
        from .services import format_ticket_code

        return format_ticket_code(obj.ticket_code) if obj.ticket_code else ""

    def get_phone(self, obj) -> str:
        # The brief's own text names the field `phone`; the User model calls it
        # `phone_number` (users/models.py) — there is no `phone` attribute at all, so
        # `getattr(obj.student, "phone", "")` would silently read "" for every row. Reading
        # the real field is what makes this list actually useful at the door.
        return str(getattr(obj.student, "phone_number", "") or "")
