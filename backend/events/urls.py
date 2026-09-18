"""Event routes.

Same layout as `stories/urls.py`: the student surface at the root of the namespace, the
console CRUD under `admin/`, and every admin route listed ABOVE anything taking an `<int:…>`
converter — otherwise "admin" is one careless converter away from being read as an event id.
"""

from django.urls import path

from .views import (
    EventCancelView,
    EventCoverView,
    EventSignUpView,
    EventsView,
    MyEventsView,
)

urlpatterns = [
    path("", EventsView.as_view(), name="events"),
    path("mine/", MyEventsView.as_view(), name="events-mine"),
    # Admin routes are added in Task 9, and they belong here — above the <int:…> block.
    path("<int:event_id>/sign-up/", EventSignUpView.as_view(), name="events-sign-up"),
    path("<int:event_id>/cancel/", EventCancelView.as_view(), name="events-cancel"),
    path("<int:event_id>/cover/", EventCoverView.as_view(), name="events-cover"),
]
