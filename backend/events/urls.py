"""Event routes.

Same layout as `stories/urls.py`: the student surface at the root of the namespace, the
console CRUD under `admin/`, and every admin route listed ABOVE anything taking an `<int:…>`
converter — otherwise "admin" is one careless converter away from being read as an event id.
"""

from django.urls import path

from .views import (
    AdminAttendanceView,
    AdminEventCancelView,
    AdminEventDetailView,
    AdminEventPublishView,
    AdminEventsView,
    AdminRegistrationsView,
    EventCancelView,
    EventCoverView,
    EventSignUpView,
    EventsView,
    MyEventsView,
)

urlpatterns = [
    path("", EventsView.as_view(), name="events"),
    path("mine/", MyEventsView.as_view(), name="events-mine"),
    path("admin/", AdminEventsView.as_view(), name="events-admin-list"),
    path(
        "admin/registrations/<int:registration_id>/attendance/",
        AdminAttendanceView.as_view(),
        name="events-admin-attendance",
    ),
    path("admin/<int:event_id>/", AdminEventDetailView.as_view(), name="events-admin-detail"),
    path("admin/<int:event_id>/publish/", AdminEventPublishView.as_view(), name="events-admin-publish"),
    path("admin/<int:event_id>/cancel/", AdminEventCancelView.as_view(), name="events-admin-cancel"),
    path(
        "admin/<int:event_id>/registrations/",
        AdminRegistrationsView.as_view(),
        name="events-admin-registrations",
    ),
    path("<int:event_id>/sign-up/", EventSignUpView.as_view(), name="events-sign-up"),
    path("<int:event_id>/cancel/", EventCancelView.as_view(), name="events-cancel"),
    path("<int:event_id>/cover/", EventCoverView.as_view(), name="events-cover"),
]
