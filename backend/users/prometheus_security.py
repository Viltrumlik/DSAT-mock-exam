from __future__ import annotations

from django.http import HttpResponse
from rest_framework.permissions import IsAdminUser
from rest_framework.views import APIView

from users.security_metrics import get


def security_metrics_prometheus() -> str:
    lines: list[str] = []

    def counter(name: str, help_text: str):
        v = get(name)
        metric = f"users_{name}_total"
        lines.append(f"# HELP {metric} {help_text}")
        lines.append(f"# TYPE {metric} counter")
        lines.append(f"{metric} {int(v)}")

    counter("failed_login", "Failed login attempts.")
    counter("refresh_fail", "Refresh failures (invalid/revoked/session missing).")
    counter("logout_revoke_fail", "Logout revoke failures.")
    counter("refresh_rotations", "Successful refresh rotations.")
    counter("refresh_reuse_grace", "Native refreshes whose lost reply was re-issued within the grace window.")
    counter("suspicious_session_churn", "Suspicious session churn events.")
    counter("security_churn_alerts", "Churn risk threshold alerts (deduped).")
    counter("security_auto_revoke", "Auto session revoke on extreme churn.")

    return "\n".join(lines) + "\n"


class AdminSecurityPrometheusMetricsView(APIView):
    """Security counters in Prometheus text — staff only, like the exams/realtime metrics views.

    It was a bare Django view, so it answered anyone, signed in or not, and nginx's metrics rule
    covers only /api/(exams|realtime|assessments)/… — not this path."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        return HttpResponse(security_metrics_prometheus(), content_type="text/plain; version=0.0.4")

