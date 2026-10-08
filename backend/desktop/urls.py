"""Windows app routes. The lockdown endpoints live on the midterm attempt itself
(``/api/midterms/attempts/<id>/desktop_challenge/`` and ``desktop_session/``)."""

from django.urls import path

from .views import AuthCodeView, AuthExchangeView, ExemptionListView, ExemptionRevokeView

urlpatterns = [
    path("auth/code/", AuthCodeView.as_view(), name="desktop-auth-code"),
    path("auth/exchange/", AuthExchangeView.as_view(), name="desktop-auth-exchange"),
    path("exemptions/", ExemptionListView.as_view(), name="desktop-exemptions"),
    path("exemptions/<int:pk>/revoke/", ExemptionRevokeView.as_view(), name="desktop-exemption-revoke"),
]
