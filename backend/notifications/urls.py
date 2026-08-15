"""Notification routes. Static segments only — nothing here takes an id."""

from django.urls import path

from .views import (
    NotificationListView,
    NotificationPreferencesView,
    NotificationReadView,
    NotificationSummaryView,
    PushConfigView,
    PushSubscribeView,
    PushUnsubscribeView,
)

urlpatterns = [
    path("", NotificationListView.as_view(), name="notifications"),
    path("summary/", NotificationSummaryView.as_view(), name="notifications-summary"),
    path("read/", NotificationReadView.as_view(), name="notifications-read"),
    path("preferences/", NotificationPreferencesView.as_view(), name="notifications-preferences"),
    path("push/config/", PushConfigView.as_view(), name="notifications-push-config"),
    path("push/subscribe/", PushSubscribeView.as_view(), name="notifications-push-subscribe"),
    path("push/unsubscribe/", PushUnsubscribeView.as_view(), name="notifications-push-unsubscribe"),
]
