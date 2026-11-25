from django.urls import path

from . import views

urlpatterns = [
    path("status/", views.StatusView.as_view(), name="staging-status"),
    path("time/", views.TimeView.as_view(), name="staging-time"),
    path("actions/", views.ActionsView.as_view(), name="staging-actions"),
    path("clock.js", views.clock_js, name="staging-clock"),
]
