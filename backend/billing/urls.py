from django.urls import path

from . import views, views_expenses

urlpatterns = [
    path("summary/", views.SummaryView.as_view(), name="billing-summary"),
    path("accounts/", views.AccountListView.as_view(), name="billing-accounts"),
    path("accounts/<int:pk>/", views.AccountDetailView.as_view(), name="billing-account"),
    path("accounts/<int:pk>/entries/", views.EntryCreateView.as_view(), name="billing-entry-create"),
    path("entries/<int:pk>/void/", views.EntryVoidView.as_view(), name="billing-entry-void"),
    path("seats/<int:pk>/price/", views.SeatPriceView.as_view(), name="billing-seat-price"),
    path("expenses/", views_expenses.ExpenseListView.as_view(), name="billing-expenses"),
    path("expenses/meta/", views_expenses.ExpenseMetaView.as_view(), name="billing-expenses-meta"),
    path("expenses/<int:pk>/void/", views_expenses.ExpenseVoidView.as_view(), name="billing-expense-void"),
    path("expense-categories/", views_expenses.ExpenseCategoryListView.as_view(), name="billing-expense-categories"),
    path(
        "expense-categories/<int:pk>/", views_expenses.ExpenseCategoryDetailView.as_view(), name="billing-expense-category"
    ),
]
