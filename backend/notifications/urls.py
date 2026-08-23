"""Notification routes. Static segments only — nothing here takes an id.

Every view is a plain ``APIView`` with its own ``permission_classes``. No hand-routed
``ViewSet.as_view({...})``: that pattern drops ``permission_classes`` silently in this
codebase, and one of the routes below writes into every account in the school.
"""

from django.urls import path

from .views import (
    NotificationBroadcastView,
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
    path("broadcast/", NotificationBroadcastView.as_view(), name="notifications-broadcast"),
    path("push/config/", PushConfigView.as_view(), name="notifications-push-config"),
    path("push/subscribe/", PushSubscribeView.as_view(), name="notifications-push-subscribe"),
    path("push/unsubscribe/", PushUnsubscribeView.as_view(), name="notifications-push-unsubscribe"),
]
