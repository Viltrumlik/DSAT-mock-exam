"""Windows app routes. The lockdown endpoints live on the midterm attempt itself
(``/api/midterms/attempts/<id>/desktop_challenge/`` and ``desktop_session/``).

``v1/`` is the native app's own API (``desktop/v1/``), switched by ``DESKTOP_V1_ENABLED``."""

from django.urls import include, path

from .views import (
    AuthCodeView,
    AuthExchangeView,
    DesktopPasswordLoginView,
    ExemptionListView,
    ExemptionRevokeView,
)

urlpatterns = [
    path("auth/code/", AuthCodeView.as_view(), name="desktop-auth-code"),
    path("auth/exchange/", AuthExchangeView.as_view(), name="desktop-auth-exchange"),
    path("auth/login/", DesktopPasswordLoginView.as_view(), name="desktop-auth-login"),
    path("exemptions/", ExemptionListView.as_view(), name="desktop-exemptions"),
    path("exemptions/<int:pk>/revoke/", ExemptionRevokeView.as_view(), name="desktop-exemption-revoke"),
    path("v1/", include("desktop.v1.urls")),
]
