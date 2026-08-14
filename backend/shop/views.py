"""The storefront, and the inventory behind it.

Staff-only endpoints carry their guard in the view, not on the nav item that reaches them —
the codebase has no per-nav-item role gating, so hiding an ops page is decoration. Same shape
as `rewards.views._is_reward_staff`, and it reuses that function rather than restating who
counts as staff: whoever may move a student's coins is exactly who may run the shop those
coins are spent in.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from rest_framework import status as http
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from rewards import coins as coins_service
from rewards import strikes as strikes_service
from rewards.views import _is_reward_staff

from . import services
from .models import ShopItem, ShopOrder
from .serializers import ShopItemSerializer, ShopItemWriteSerializer, ShopOrderSerializer

#: An order history is a reminder of what you bought, not an archive.
HISTORY_LIMIT = 50


class _StaffView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _guard(self, request):
        if not _is_reward_staff(request.user):
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        return None


class ShopView(APIView):
    """The two shelves, the student's balances, and what each item would cost them.

    Both currencies come back in one response on purpose. A student deciding between a coin
    item and a strike item needs both numbers on screen, and two requests to build one page is
    two chances for the page to render half-informed.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        items = list(ShopItem.objects.filter(is_active=True))
        afford = services.affordability(request.user, items)
        wallet = coins_service.wallet_state(request.user)
        strike_state = strikes_service.state(request.user)

        def _shelf(currency):
            return [
                {**ShopItemSerializer(item, context={"request": request}).data, **afford[item.pk]}
                for item in items
                if item.currency == currency
            ]

        return Response({
            "coins": wallet["coins"],
            "convertible_coins": wallet["convertible_coins"],
            "strikes": strike_state["strikes"],
            "current_streak": strike_state["current_streak"],
            "best_streak": strike_state["best_streak"],
            "coin_items": _shelf(ShopItem.CURRENCY_COIN),
            "strike_items": _shelf(ShopItem.CURRENCY_STRIKE),
        })


class PurchaseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, item_id):
        try:
            order = services.purchase(request.user, item_id, actor=request.user)
        except ValidationError as exc:
            # The service's own wording reaches the student: "Not enough coins: 3 available,
            # 5 needed" says what is missing, which is the copy rule for this surface.
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        return Response(
            {
                "detail": f"Ordered. Collect your {order.item_name} from the desk.",
                "order": ShopOrderSerializer(order, context={"request": request}).data,
            },
            status=http.HTTP_201_CREATED,
        )


class MyOrdersView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        orders = ShopOrder.objects.filter(student=request.user).select_related("item")[:HISTORY_LIMIT]
        return Response({
            "orders": ShopOrderSerializer(orders, many=True, context={"request": request}).data
        })


class AdminItemsView(_StaffView):
    """List every item including the hidden ones, and add new ones."""

    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        items = ShopItem.objects.all()
        return Response({
            "items": ShopItemSerializer(items, many=True, context={"request": request}).data
        })

    def post(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        serializer = ShopItemWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = serializer.save(created_by=request.user)
        return Response(
            ShopItemSerializer(item, context={"request": request}).data,
            status=http.HTTP_201_CREATED,
        )


class AdminItemDetailView(_StaffView):
    def patch(self, request, item_id):
        denied = self._guard(request)
        if denied:
            return denied
        item = get_object_or_404(ShopItem, pk=item_id)
        serializer = ShopItemWriteSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(ShopItemSerializer(item, context={"request": request}).data)

    def delete(self, request, item_id):
        denied = self._guard(request)
        if denied:
            return denied
        item = get_object_or_404(ShopItem, pk=item_id)
        if item.orders.exists():
            # PROTECT would raise anyway; this turns a 500 into an answer. Delisting keeps
            # every order that already points at it readable.
            item.is_active = False
            item.save(update_fields=["is_active", "updated_at"])
            return Response({
                "detail": "Students have ordered this, so it was hidden rather than deleted.",
                "deleted": False,
            })
        item.delete()
        return Response({"detail": "Deleted.", "deleted": True})


class AdminOrdersView(_StaffView):
    """The fulfilment queue. Defaults to what still needs handing over."""

    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        status_filter = (request.query_params.get("status") or ShopOrder.STATUS_PENDING).upper()
        orders = ShopOrder.objects.select_related("item", "student")
        if status_filter != "ALL":
            orders = orders.filter(status=status_filter)
        return Response({
            "orders": ShopOrderSerializer(
                orders[:200], many=True, context={"request": request}
            ).data
        })


class AdminOrderSettleView(_StaffView):
    def post(self, request, order_id):
        denied = self._guard(request)
        if denied:
            return denied
        action = str(request.data.get("action") or "fulfil").lower()
        note = (request.data.get("note") or "").strip()
        try:
            if action == "cancel":
                order = services.cancel(order_id, actor=request.user, note=note)
            else:
                order = services.fulfil(order_id, actor=request.user, note=note)
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        return Response(ShopOrderSerializer(order, context={"request": request}).data)
