from __future__ import annotations

from rest_framework import serializers

from .models import ShopItem, ShopOrder


def _image_url(instance, request=None):
    """Signed URL for an item photo, or None.

    The `ValueError` guard is the house pattern (questionbank/serializers.py, assessments/
    helpers.py): calling `.url` on an unset FileField raises rather than returning None, and
    the R2 bucket is private, so every URL is signed and expiring.
    """
    image = getattr(instance, "image", None)
    if not image:
        return None
    try:
        url = image.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request and url.startswith("/") else url


class ShopItemSerializer(serializers.ModelSerializer):
    """What a student sees on a shelf."""

    image_url = serializers.SerializerMethodField()
    currency_label = serializers.CharField(source="get_currency_display", read_only=True)
    in_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = ShopItem
        fields = [
            "id", "name", "description", "image_url",
            "currency", "currency_label", "price",
            "stock", "in_stock", "is_active", "sort_order",
        ]

    def get_image_url(self, obj):
        return _image_url(obj, self.context.get("request"))


class ShopItemWriteSerializer(serializers.ModelSerializer):
    """Admin create/update. Accepts a multipart `image`."""

    class Meta:
        model = ShopItem
        fields = ["name", "description", "image", "currency", "price", "stock", "is_active", "sort_order"]

    def validate_price(self, value):
        # A free item is not a shop item — it is a giveaway, and a price of 0 would let a
        # student "buy" unlimited stock without any balance at all.
        if int(value) <= 0:
            raise serializers.ValidationError("Give it a price above zero.")
        return value


class ShopOrderSerializer(serializers.ModelSerializer):
    student_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ShopOrder
        fields = [
            "id", "student", "student_name", "item", "item_name", "image_url",
            "currency", "price", "status", "status_label", "note",
            "created_at", "settled_at",
        ]

    def get_student_name(self, obj):
        user = obj.student
        name = f"{user.first_name or ''} {user.last_name or ''}".strip()
        return name or user.username or user.email or "Student"

    def get_image_url(self, obj):
        return _image_url(obj.item, self.context.get("request"))
