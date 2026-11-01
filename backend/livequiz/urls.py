from django.urls import path

from .views import (
    HostOptionsView,
    JoinView,
    MyLiveSessionsView,
    SessionDetailView,
    SessionJoinByIdView,
    SessionListCreateView,
    SessionResultsView,
    SessionTerminateView,
    ShopBuyView,
    ShopClaimView,
    ShopEquipView,
    ShopView,
)

urlpatterns = [
    # Declared before the <int:pk> routes so neither is swallowed by them.
    path("join/", JoinView.as_view(), name="livequiz-join"),
    path("mine/", MyLiveSessionsView.as_view(), name="livequiz-mine"),
    path("options/", HostOptionsView.as_view(), name="livequiz-options"),
    path("shop/", ShopView.as_view(), name="livequiz-shop"),
    path("shop/buy/", ShopBuyView.as_view(), name="livequiz-shop-buy"),
    path("shop/claim/", ShopClaimView.as_view(), name="livequiz-shop-claim"),
    path("shop/equip/", ShopEquipView.as_view(), name="livequiz-shop-equip"),
    path("sessions/", SessionListCreateView.as_view(), name="livequiz-sessions"),
    path("sessions/<int:pk>/", SessionDetailView.as_view(), name="livequiz-session-detail"),
    path(
        "sessions/<int:pk>/join/",
        SessionJoinByIdView.as_view(),
        name="livequiz-session-join",
    ),
    path(
        "sessions/<int:pk>/terminate/",
        SessionTerminateView.as_view(),
        name="livequiz-session-terminate",
    ),
    path(
        "sessions/<int:pk>/results/",
        SessionResultsView.as_view(),
        name="livequiz-session-results",
    ),
]
