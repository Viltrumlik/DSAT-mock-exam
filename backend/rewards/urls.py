from django.urls import path

from .views import MyRewardsView, RewardRulesView

urlpatterns = [
    path("me/", MyRewardsView.as_view(), name="rewards-me"),
    path("rules/", RewardRulesView.as_view(), name="rewards-rules"),
]
