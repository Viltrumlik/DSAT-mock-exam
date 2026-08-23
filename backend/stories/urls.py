"""Story routes.

Same layout as `shop/urls.py`: the student surface sits at the root of the namespace, the
console CRUD sits under `admin/`, and the admin routes are listed above anything taking an
`<int:…>` — the house rule, otherwise "admin" is one careless converter away from being read
as a story id.

The resource is named inside `admin/` (`admin/stories/`) even though this app has only one
model, so that the shape matches `admin/items/` and `admin/orders/` next door and a second
model — story views, say — has somewhere obvious to go.
"""

from django.urls import path

from .views import AdminStoriesView, AdminStoryDetailView, StoriesView

urlpatterns = [
    path("", StoriesView.as_view(), name="stories"),
    path("admin/stories/", AdminStoriesView.as_view(), name="stories-admin-list"),
    path("admin/stories/<int:story_id>/", AdminStoryDetailView.as_view(), name="stories-admin-detail"),
]
