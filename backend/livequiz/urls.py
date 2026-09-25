from django.urls import path

from .views import (
    HostOptionsView,
    JoinView,
    MyLiveSessionsView,
    SessionDetailView,
    SessionListCreateView,
    SessionResultsView,
    SessionTerminateView,
)

urlpatterns = [
    # Declared before the <int:pk> routes so neither is swallowed by them.
    path("join/", JoinView.as_view(), name="livequiz-join"),
    path("mine/", MyLiveSessionsView.as_view(), name="livequiz-mine"),
    path("options/", HostOptionsView.as_view(), name="livequiz-options"),
    path("sessions/", SessionListCreateView.as_view(), name="livequiz-sessions"),
    path("sessions/<int:pk>/", SessionDetailView.as_view(), name="livequiz-session-detail"),
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
