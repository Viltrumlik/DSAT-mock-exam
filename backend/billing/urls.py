from django.urls import path

from . import views

urlpatterns = [
    path("summary/", views.SummaryView.as_view(), name="billing-summary"),
    path("accounts/", views.AccountListView.as_view(), name="billing-accounts"),
    path("accounts/<int:pk>/", views.AccountDetailView.as_view(), name="billing-account"),
]
