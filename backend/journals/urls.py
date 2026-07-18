"""Journal URLs.

Collection + bulk paths are registered BEFORE ``<int:pk>`` catch-alls so they win.
"""

from django.urls import path

from .views import (
    ClassworkDetailView,
    JournalArchiveView,
    JournalContentOptionsView,
    JournalDetailView,
    JournalDuplicateView,
    JournalExportView,
    JournalImportView,
    JournalListCreateView,
    JournalMidtermOptionsView,
    JournalPublishView,
    JournalSessionCreateView,
    JournalUnarchiveView,
    LessonBulkView,
    LessonDetailView,
    LessonListView,
    LessonPublishView,
    LessonResetView,
)

app_name = "journals"

urlpatterns = [
    # Collection + non-pk paths first.
    path("", JournalListCreateView.as_view(), name="journal-list"),
    path("content-options/", JournalContentOptionsView.as_view(), name="content-options"),
    path("midterm-options/", JournalMidtermOptionsView.as_view(), name="midterm-options"),
    path("import/", JournalImportView.as_view(), name="journal-import"),
    # Journal detail + lifecycle.
    path("<int:pk>/", JournalDetailView.as_view(), name="journal-detail"),
    path("<int:pk>/publish/", JournalPublishView.as_view(), name="journal-publish"),
    path("<int:pk>/archive/", JournalArchiveView.as_view(), name="journal-archive"),
    path("<int:pk>/unarchive/", JournalUnarchiveView.as_view(), name="journal-unarchive"),
    path("<int:pk>/duplicate/", JournalDuplicateView.as_view(), name="journal-duplicate"),
    path("<int:pk>/export/", JournalExportView.as_view(), name="journal-export"),
    # Sessions ("New session" — nothing is pre-provisioned).
    path("<int:pk>/sessions/", JournalSessionCreateView.as_view(), name="session-create"),
    # Lessons (nested). Bulk before <int:pk>.
    path("<int:journal_pk>/lessons/", LessonListView.as_view(), name="lesson-list"),
    path("<int:journal_pk>/lessons/bulk/", LessonBulkView.as_view(), name="lesson-bulk"),
    path("<int:journal_pk>/lessons/<int:pk>/", LessonDetailView.as_view(), name="lesson-detail"),
    path(
        "<int:journal_pk>/lessons/<int:pk>/classwork/",
        ClassworkDetailView.as_view(),
        name="lesson-classwork",
    ),
    path("<int:journal_pk>/lessons/<int:pk>/publish/", LessonPublishView.as_view(), name="lesson-publish"),
    path("<int:journal_pk>/lessons/<int:pk>/reset/", LessonResetView.as_view(), name="lesson-reset"),
]
