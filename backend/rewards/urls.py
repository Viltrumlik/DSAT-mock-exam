from django.urls import path

from .views import MyRewardsView, MyWalletView, RewardRulesView, WalletAdminView

urlpatterns = [
    path("me/", MyRewardsView.as_view(), name="rewards-me"),
    path("rules/", RewardRulesView.as_view(), name="rewards-rules"),
    path("wallet/", MyWalletView.as_view(), name="rewards-wallet"),
    path("wallet/<int:student_id>/", WalletAdminView.as_view(), name="rewards-wallet-admin"),
]
