from django.contrib import admin

from .models import Dataset, DatasetColumn, DatasetImport


class DatasetImportInline(admin.TabularInline):
    model = DatasetImport
    extra = 0
    fields = (
        "original_filename",
        "row_count",
        "column_count",
        "encoding",
        "delimiter",
        "status",
        "created_at",
    )
    readonly_fields = fields
    can_delete = False


@admin.register(Dataset)
class DatasetAdmin(admin.ModelAdmin):
    list_display = ("name", "organisation", "status", "created_by", "created_at")
    list_filter = ("status", "organisation")
    search_fields = ("name", "organisation__name")
    readonly_fields = ("created_at", "updated_at", "current_import")
    inlines = (DatasetImportInline,)


class DatasetColumnInline(admin.TabularInline):
    model = DatasetColumn
    extra = 0
    fields = ("position", "source_name", "inferred_type", "canonical_field", "null_count")
    readonly_fields = fields
    can_delete = False


@admin.register(DatasetImport)
class DatasetImportAdmin(admin.ModelAdmin):
    list_display = (
        "original_filename",
        "dataset",
        "row_count",
        "column_count",
        "status",
        "created_at",
    )
    list_filter = ("status",)
    search_fields = ("original_filename", "dataset__name")
    readonly_fields = (
        "file",
        "checksum_sha256",
        "size_bytes",
        "row_count",
        "column_count",
        "encoding",
        "delimiter",
        "warnings",
        "created_at",
    )
    inlines = (DatasetColumnInline,)
