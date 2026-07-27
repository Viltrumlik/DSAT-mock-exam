"""
Vocabulary URLs.

Explicit ``path()`` entries over ``APIView``s — this app has no ViewSet and no router.
The ``admin/`` prefix is listed after the student paths but never shadows them: an
``<int:pk>`` converter cannot match the literal segment "admin".
"""

from django.urls import path

from .views_admin import (
    AdminSectionCsvImportView,
    AdminSectionDetailView,
    AdminSectionListCreateView,
    AdminSectionSetListCreateView,
    AdminSetCsvImportView,
    AdminSetDetailView,
    AdminSetWordListCreateView,
    AdminWordDetailView,
)
from .views_student import (
    HomeworkListView,
    MySetDetailView,
    MySetListCreateView,
    SectionDetailView,
    SectionListView,
    SessionCreateView,
    SessionFinishView,
    SetDetailView,
    WordSearchView,
)

urlpatterns = [
    # Student
    path("sections/", SectionListView.as_view(), name="vocab-sections"),
    path("sections/<int:pk>/", SectionDetailView.as_view(), name="vocab-section-detail"),
    path("sets/<int:pk>/", SetDetailView.as_view(), name="vocab-set-detail"),
    path("words/", WordSearchView.as_view(), name="vocab-word-search"),
    path("my-sets/", MySetListCreateView.as_view(), name="vocab-my-sets"),
    path("my-sets/<int:pk>/", MySetDetailView.as_view(), name="vocab-my-set-detail"),
    path("homework/", HomeworkListView.as_view(), name="vocab-homework"),
    path("sessions/", SessionCreateView.as_view(), name="vocab-session-create"),
    path("sessions/<int:pk>/finish/", SessionFinishView.as_view(), name="vocab-session-finish"),
    # Builder
    path("admin/sections/", AdminSectionListCreateView.as_view(), name="vocab-admin-sections"),
    path(
        "admin/sections/<int:pk>/",
        AdminSectionDetailView.as_view(),
        name="vocab-admin-section-detail",
    ),
    path(
        "admin/sections/<int:pk>/sets/",
        AdminSectionSetListCreateView.as_view(),
        name="vocab-admin-section-sets",
    ),
    path(
        "admin/sections/<int:pk>/import-csv/",
        AdminSectionCsvImportView.as_view(),
        name="vocab-admin-section-import-csv",
    ),
    path("admin/sets/<int:pk>/", AdminSetDetailView.as_view(), name="vocab-admin-set-detail"),
    path(
        "admin/sets/<int:pk>/words/",
        AdminSetWordListCreateView.as_view(),
        name="vocab-admin-set-words",
    ),
    path(
        "admin/sets/<int:pk>/import-csv/",
        AdminSetCsvImportView.as_view(),
        name="vocab-admin-set-import-csv",
    ),
    path("admin/words/<int:pk>/", AdminWordDetailView.as_view(), name="vocab-admin-word-detail"),
]
