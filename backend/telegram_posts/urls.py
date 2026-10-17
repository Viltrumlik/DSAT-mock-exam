"""Group post routes — all under `admin/`; the fixed `groups/` route sits above the converters."""

from django.urls import path

from .views import AdminGroupsView, AdminPostActionView, AdminPostDetailView, AdminPostsView

urlpatterns = [
    path("admin/", AdminPostsView.as_view(), name="telegram-posts-admin-list"),
    path("admin/groups/", AdminGroupsView.as_view(), name="telegram-posts-admin-groups"),
    path("admin/<int:post_id>/", AdminPostDetailView.as_view(), name="telegram-posts-admin-detail"),
    path(
        "admin/<int:post_id>/<slug:action>/",
        AdminPostActionView.as_view(),
        name="telegram-posts-admin-action",
    ),
]
