"""What the API says about an event.

One read serializer for both surfaces, like `stories`. The student's own seat rides along in
`my_registration` rather than as a second request: every card needs it, and a second round
trip per card is what makes a list page feel broken on a phone.
"""

from __future__ import annotations

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

    class Meta:
        model = EventRegistration
        fields = ["id", "status", "attendance", "registered_at", "points_awarded"]

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
