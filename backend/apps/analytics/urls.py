from django.urls import path

from .views import (
    BasketAnalysisView,
    GeographyPerformanceView,
    ProductDetailView,
    ProductPerformanceView,
    ReturnsAnalysisView,
    SalesSummaryView,
    SalesTrendView,
)

urlpatterns = [
    path("sales/summary", SalesSummaryView.as_view(), name="sales-summary"),
    path("sales/trend", SalesTrendView.as_view(), name="sales-trend"),
    path(
        "products/performance",
        ProductPerformanceView.as_view(),
        name="product-performance",
    ),
    path("products/<int:product_id>", ProductDetailView.as_view(), name="product-detail"),
    path(
        "geography/performance",
        GeographyPerformanceView.as_view(),
        name="geography-performance",
    ),
    path("returns", ReturnsAnalysisView.as_view(), name="returns-analysis"),
    path("basket", BasketAnalysisView.as_view(), name="basket-analysis"),
]
