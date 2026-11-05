from django.urls import path

from . import views

urlpatterns = [
    path("summary/", views.SummaryView.as_view(), name="billing-summary"),
    path("accounts/", views.AccountListView.as_view(), name="billing-accounts"),
    path("accounts/<int:pk>/", views.AccountDetailView.as_view(), name="billing-account"),
    path("accounts/<int:pk>/entries/", views.EntryCreateView.as_view(), name="billing-entry-create"),
    path("entries/<int:pk>/void/", views.EntryVoidView.as_view(), name="billing-entry-void"),
    path("seats/<int:pk>/price/", views.SeatPriceView.as_view(), name="billing-seat-price"),
]
