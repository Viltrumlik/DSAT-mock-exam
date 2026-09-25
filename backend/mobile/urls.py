"""Mobile app routes.

Same layout as `stories/urls.py`: the app's own endpoints at the root of the namespace, the
console under `admin/`, and every admin route listed ABOVE anything taking an `<int:…>`.
"""

from django.urls import path

from .views import (
    AdminDiagnosticDetailView,
    AdminDiagnosticsView,
    AdminPolicyView,
    AppConfigView,
    DiagnosticsUploadView,
)

urlpatterns = [
    path("config/", AppConfigView.as_view(), name="mobile-config"),
    path("diagnostics/", DiagnosticsUploadView.as_view(), name="mobile-diagnostics"),
    path("admin/policy/", AdminPolicyView.as_view(), name="mobile-admin-policy"),
    path("admin/diagnostics/", AdminDiagnosticsView.as_view(), name="mobile-admin-diagnostics"),
    path(
        "admin/diagnostics/<int:diagnostic_id>/",
        AdminDiagnosticDetailView.as_view(),
        name="mobile-admin-diagnostic-detail",
    ),
]
