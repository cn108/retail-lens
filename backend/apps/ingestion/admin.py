from django.contrib import admin

from .models import (
    DataQualityIssue,
    DimCustomer,
    DimDate,
    DimGeography,
    DimProduct,
    FactReturn,
    FactSales,
    ProcessingLog,
    RawTransaction,
)


@admin.register(ProcessingLog)
class ProcessingLogAdmin(admin.ModelAdmin):
    list_display = (
        "dataset",
        "status",
        "rows_read",
        "rows_loaded",
        "rows_rejected",
        "created_at",
    )
    list_filter = ("status",)
    search_fields = ("dataset__name",)
    readonly_fields = (
        "started_at",
        "finished_at",
        "rows_read",
        "rows_loaded",
        "rows_rejected",
        "summary",
        "error_message",
        "created_at",
    )


@admin.register(DataQualityIssue)
class DataQualityIssueAdmin(admin.ModelAdmin):
    list_display = ("dataset", "row_number", "code", "message", "created_at")
    list_filter = ("code",)
    search_fields = ("dataset__name", "message")


@admin.register(RawTransaction)
class RawTransactionAdmin(admin.ModelAdmin):
    list_display = ("dataset", "row_number")
    search_fields = ("dataset__name",)
    readonly_fields = ("payload",)


class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):  # type: ignore[no-untyped-def]
        return False

    def has_change_permission(self, request, obj=None):  # type: ignore[no-untyped-def]
        return False


admin.site.register(DimDate, ReadOnlyAdmin)
admin.site.register(DimCustomer, ReadOnlyAdmin)
admin.site.register(DimProduct, ReadOnlyAdmin)
admin.site.register(DimGeography, ReadOnlyAdmin)
admin.site.register(FactSales, ReadOnlyAdmin)
admin.site.register(FactReturn, ReadOnlyAdmin)
