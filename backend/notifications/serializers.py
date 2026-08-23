from __future__ import annotations

from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.BooleanField(read_only=True)
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Notification
        fields = [
            "id", "category", "category_label", "event",
            "title", "body", "link_url", "is_read", "read_at", "created_at",
        ]


#: Who a broadcast can be aimed at. Deliberately a small closed set of *roles* rather than a
#: free-form user-id list: the school's use for this is "tell everybody the centre is shut on
#: Thursday", and an endpoint that accepted arbitrary recipients would be a targeting tool
#: nobody asked for and a much larger thing to get wrong.
AUDIENCE_ALL = "all"
AUDIENCE_STUDENTS = "students"
AUDIENCE_TEACHERS = "teachers"
AUDIENCE_STAFF = "staff"

AUDIENCE_CHOICES = (AUDIENCE_ALL, AUDIENCE_STUDENTS, AUDIENCE_TEACHERS, AUDIENCE_STAFF)


class NotificationBroadcastSerializer(serializers.Serializer):
    """What a super_admin may say, and to whom.

    Validated as a serializer rather than by hand so a bad request comes back as per-field
    errors the ops console can render next to the offending input. The length caps are the
    model's own — a title truncated silently at 160 characters would put an announcement in
    front of the whole school with its last words missing.
    """

    title = serializers.CharField(max_length=160, trim_whitespace=True)
    body = serializers.CharField(
        max_length=400, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    #: Relative, like every other `link_url`. The platform is served from several subdomains
    #: and an absolute URL in a broadcast would send half the recipients to the wrong console.
    link_url = serializers.CharField(
        max_length=300, required=False, allow_blank=True, default=""
    )
    audience = serializers.ChoiceField(choices=AUDIENCE_CHOICES, default=AUDIENCE_ALL)
    #: Buzz phones as well as filling the bell. **Off by default, deliberately.**
    #:
    #: ``constants.PUSH_EVENTS`` keeps the pushing set short on purpose — a platform that
    #: pushes everything teaches students to switch push off, after which the notification
    #: that mattered does not arrive either — and ``EVENT_SYSTEM`` is not in it. But "the
    #: centre is closed tomorrow" is exactly the announcement that should reach a phone, so
    #: the choice belongs to the person writing it rather than to a constant. Opting in is an
    #: act; the default stays quiet.
    push = serializers.BooleanField(required=False, default=False)

    def validate_title(self, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("A broadcast needs something to say.")
        return value

    def validate_link_url(self, value: str) -> str:
        value = (value or "").strip()
        if not value:
            return ""
        if not value.startswith("/"):
            raise serializers.ValidationError(
                "Use a relative path such as /classes — an absolute URL would send teachers "
                "to the student site and students to the teacher portal."
            )
        # `//host/path` is a protocol-relative URL, which is absolute in every browser despite
        # starting with a slash. Rejecting it here keeps the "relative only" promise real.
        if value.startswith("//"):
            raise serializers.ValidationError("Use a path on this site, not another host.")
        return value
