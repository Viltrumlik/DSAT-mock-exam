"""Shop routes.

Admin routes sit above anything taking an `<int:…>`, the house rule — otherwise "admin" is
one careless converter away from being read as an item id.
"""

from django.urls import path

from .views import (
    AdminItemDetailView,
    AdminItemsView,
    AdminOrderSettleView,
    AdminOrdersView,
    MyOrdersView,
    PurchaseView,
    ShopView,
)

urlpatterns = [
    path("", ShopView.as_view(), name="shop"),
    path("orders/", MyOrdersView.as_view(), name="shop-my-orders"),
    path("admin/items/", AdminItemsView.as_view(), name="shop-admin-items"),
    path("admin/items/<int:item_id>/", AdminItemDetailView.as_view(), name="shop-admin-item"),
    path("admin/orders/", AdminOrdersView.as_view(), name="shop-admin-orders"),
    path("admin/orders/<int:order_id>/settle/", AdminOrderSettleView.as_view(), name="shop-admin-order-settle"),
    path("items/<int:item_id>/purchase/", PurchaseView.as_view(), name="shop-purchase"),
]
