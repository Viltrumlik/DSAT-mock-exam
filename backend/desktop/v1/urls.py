"""``/api/desktop/v1/`` routes (no trailing slashes — the wire contract's paths).

Mounted from ``desktop/urls.py``. Every route is behind ``DESKTOP_V1_ENABLED`` (checked in
``V1APIView.initial``, before authentication); the catch-all at the end gives an unknown v1 path
the same envelope instead of an HTML page.
"""

from django.urls import path, re_path

from . import home, media, midterms, pastpapers
from .conventions import V1APIView, not_visible


class UnknownV1PathView(V1APIView):
    authentication_classes: list = []
    permission_classes: list = []

    def _missing(self, request, *args, **kwargs):
        raise not_visible("There is nothing here.")

    get = post = put = patch = delete = _missing


urlpatterns = [
    path("home", home.HomeView.as_view(), name="desktop-v1-home"),
    # past papers
    path("pastpapers/<int:practice_test_id>/open", pastpapers.PastpaperOpenView.as_view(), name="desktop-v1-pastpaper-open"),
    path("pastpapers/attempts/<int:attempt_id>/start", pastpapers.PastpaperStartView.as_view(), name="desktop-v1-pastpaper-start"),
    path("pastpapers/attempts/<int:attempt_id>/sync", pastpapers.PastpaperSyncView.as_view(), name="desktop-v1-pastpaper-sync"),
    path("pastpapers/attempts/<int:attempt_id>/submit", pastpapers.PastpaperSubmitView.as_view(), name="desktop-v1-pastpaper-submit"),
    path("pastpapers/attempts/<int:attempt_id>/pause", pastpapers.PastpaperPauseView.as_view(), name="desktop-v1-pastpaper-pause"),
    path("pastpapers/attempts/<int:attempt_id>/resume", pastpapers.PastpaperResumeView.as_view(), name="desktop-v1-pastpaper-resume"),
    path("pastpapers/attempts/<int:attempt_id>/result", pastpapers.PastpaperResultView.as_view(), name="desktop-v1-pastpaper-result"),
    # midterms
    path("midterms/<int:midterm_id>/prepare", midterms.MidtermPrepareView.as_view(), name="desktop-v1-midterm-prepare"),
    path("midterms/attempts/<int:attempt_id>/open", midterms.MidtermOpenView.as_view(), name="desktop-v1-midterm-open"),
    path("midterms/attempts/<int:attempt_id>/sync", midterms.MidtermSyncView.as_view(), name="desktop-v1-midterm-sync"),
    path("midterms/attempts/<int:attempt_id>/submit", midterms.MidtermSubmitView.as_view(), name="desktop-v1-midterm-submit"),
    path("midterms/attempts/<int:attempt_id>/offscreen", midterms.MidtermOffscreenView.as_view(), name="desktop-v1-midterm-offscreen"),
    path("midterms/attempts/<int:attempt_id>/result", midterms.MidtermResultView.as_view(), name="desktop-v1-midterm-result"),
    # images
    path("attempts/<str:kind>/<int:attempt_id>/media", media.AttemptMediaView.as_view(), name="desktop-v1-media"),
    re_path(r"^.*$", UnknownV1PathView.as_view(), name="desktop-v1-unknown"),
]
