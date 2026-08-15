from django.urls import path

from .views import (
    ConvertPointsView,
    LeaderboardFiltersView,
    LeaderboardView,
    MyRewardsView,
    MyWalletView,
    RewardRulesView,
    WalletAdminView,
)

urlpatterns = [
    path("me/", MyRewardsView.as_view(), name="rewards-me"),
    path("rules/", RewardRulesView.as_view(), name="rewards-rules"),
    path("wallet/", MyWalletView.as_view(), name="rewards-wallet"),
    path("wallet/convert/", ConvertPointsView.as_view(), name="rewards-wallet-convert"),
    path("leaderboard/", LeaderboardView.as_view(), name="rewards-leaderboard"),
    path("leaderboard/filters/", LeaderboardFiltersView.as_view(), name="rewards-leaderboard-filters"),
    path("wallet/<int:student_id>/", WalletAdminView.as_view(), name="rewards-wallet-admin"),
]
