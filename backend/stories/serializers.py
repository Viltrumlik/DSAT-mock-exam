from __future__ import annotations

from rest_framework import serializers

from .models import Story


def _image_url(instance, request=None):
    """Signed URL for a story image, or None.

    The `ValueError` guard is the house pattern (shop/serializers.py, questionbank/
    serializers.py, assessments/helpers.py): calling `.url` on an unset FileField raises
    rather than returning None, so a story saved without a picture — which the model allows,
    and which the Django admin makes easy — would 500 the whole rail rather than render one
    empty circle. The R2 bucket is private, so what comes back is signed and expires in about
    an hour (see the STORAGES block in config/settings.py).
    """
    image = getattr(instance, "image", None)
    if not image:
        return None
    try:
        url = image.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request and url.startswith("/") else url


class StorySerializer(serializers.ModelSerializer):
    """What both the student rail and the ops console read.

    One read serializer, not two. A student is sent the publish window as well, which is more
    than the rail draws — but a story is a public notice, so there is nothing in `starts_at`
    or `is_active` that a student may not see, and paying a second serializer that drifts from
    this one to withhold two harmless timestamps is the worse trade. The console needs exactly
    this shape plus `is_live`, and `is_live` is a context question, not a different model.
    """

    image_url = serializers.SerializerMethodField()
    is_live = serializers.SerializerMethodField()

    class Meta:
        model = Story
        fields = [
            "id", "title", "caption", "image_url", "link_url",
            "is_active", "sort_order", "starts_at", "ends_at",
            "is_live", "created_at",
        ]

    def get_image_url(self, obj):
        return _image_url(obj, self.context.get("request"))

    def get_is_live(self, obj):
        """Is this one actually on the rail at this moment?

        Answered from a `live_ids` set the caller put in the context, resolved in one query
        for the whole page — never by re-deriving the window here, which would be a second
        copy of the rule `models.live_window` exists to be the only copy of, and never by
        asking the database per row.

        No `live_ids` in the context means the caller only ever selected live stories in the
        first place (the student rail does exactly that), so the answer is True.
        """
        live_ids = self.context.get("live_ids")
        if live_ids is None:
            return True
        return obj.pk in live_ids


class StoryWriteSerializer(serializers.ModelSerializer):
    """Admin create/update. Accepts a multipart `image`, same as `ShopItemWriteSerializer`."""

    # Required on create, because a story with no image is an empty circle on the dashboard —
    # the picture *is* the story here. `partial=True` on PATCH lifts this, so editing a title
    # does not force the administrator to re-upload the flyer.
    image = serializers.ImageField(required=True)

    class Meta:
        model = Story
        fields = [
            "image", "title", "caption", "link_url",
            "is_active", "sort_order", "starts_at", "ends_at",
        ]

    def validate_title(self, value):
        title = (value or "").strip()
        if not title:
            raise serializers.ValidationError("Give it a title — it is the label under the circle.")
        return title

    def validate(self, attrs):
        # Both ends of the window are optional, but a window that closes before it opens is a
        # story that will never be seen by anybody. Refusing it here is the only chance to say
        # so; once saved it simply never appears, and looks like a bug in the rail.
        instance = getattr(self, "instance", None)
        starts_at = attrs.get("starts_at", getattr(instance, "starts_at", None))
        ends_at = attrs.get("ends_at", getattr(instance, "ends_at", None))
        if starts_at and ends_at and ends_at <= starts_at:
            raise serializers.ValidationError(
                {"ends_at": "The story would end before it started. Move the end time later."}
            )
        return attrs
