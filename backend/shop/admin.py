from django.contrib import admin

from .models import ShopItem, ShopOrder


@admin.register(ShopItem)
class ShopItemAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "currency", "price", "stock", "is_active", "sort_order")
    list_filter = ("currency", "is_active")
    search_fields = ("name", "description")
    list_editable = ("price", "stock", "is_active", "sort_order")
    # Editable, unlike the reward ledger next door: stock is a fact about a shelf that an
    # administrator maintains, not a record of something that happened.


@admin.register(ShopOrder)
class ShopOrderAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "item_name", "currency", "price", "status", "created_at")
    list_filter = ("status", "currency", "created_at")
    search_fields = ("item_name", "student__email", "student__username")
    readonly_fields = [f.name for f in ShopOrder._meta.fields]

    def has_add_permission(self, request):
        # An order is created by a purchase, which moves a balance through the reward ledger.
        # Adding one here would produce an order nobody paid for.
        return False

    def has_change_permission(self, request, obj=None):
        # Fulfil and cancel go through `shop.services`, which refunds and restocks. Flipping
        # `status` by hand here would mark an order cancelled and keep the student's money.
        return False
