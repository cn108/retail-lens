"""Raw preservation, processing history and the analytical warehouse.

The warehouse grain is fixed in docs/DATABASE_DESIGN.md: one fact row per
invoice line, returns stored separately with negative measures, and dimensions
scoped to the dataset that produced them. `RawTransaction` keeps every source
row exactly as read, including rows that fail validation.
"""

import uuid

from django.db import models


class ProcessingStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    RUNNING = "running", "Running"
    SUCCEEDED = "succeeded", "Succeeded"
    FAILED = "failed", "Failed"


class IssueCode(models.TextChoices):
    MISSING_INVOICE = "missing_invoice", "Missing invoice number"
    INVALID_DATE = "invalid_date", "Invalid invoice date"
    MISSING_PRODUCT = "missing_product", "Missing product code"
    INVALID_QUANTITY = "invalid_quantity", "Invalid quantity"
    INVALID_PRICE = "invalid_price", "Invalid unit price"
    INVALID_DISCOUNT = "invalid_discount", "Invalid discount"
    INVALID_RETURN_FLAG = "invalid_return_flag", "Invalid return flag"
    DUPLICATE_LINE = "duplicate_line", "Duplicate invoice line"


class ProcessingLog(models.Model):
    """One processing attempt; the job resource the API exposes."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dataset = models.ForeignKey(
        "datasets.Dataset", on_delete=models.CASCADE, related_name="processing_runs"
    )
    status = models.CharField(
        max_length=16, choices=ProcessingStatus.choices, default=ProcessingStatus.QUEUED
    )
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    rows_read = models.PositiveIntegerField(default=0)
    rows_loaded = models.PositiveIntegerField(default=0)
    rows_rejected = models.PositiveIntegerField(default=0)
    summary = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True)
    created_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "processing_logs"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["dataset", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.dataset_id} {self.status}"


class DataQualityIssue(models.Model):
    """A source row that could not be loaded, kept for the quality report."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dataset = models.ForeignKey(
        "datasets.Dataset", on_delete=models.CASCADE, related_name="quality_issues"
    )
    processing_run = models.ForeignKey(
        ProcessingLog,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="issues",
    )
    row_number = models.PositiveIntegerField()
    code = models.CharField(max_length=32, choices=IssueCode.choices)
    message = models.CharField(max_length=255)
    source_column = models.CharField(max_length=255, blank=True)
    raw_value = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "data_quality_issues"
        ordering = ["row_number", "id"]
        indexes = [models.Index(fields=["dataset", "row_number"])]

    def __str__(self) -> str:
        return f"row {self.row_number}: {self.code}"


class RawTransaction(models.Model):
    """One physical source row, preserved verbatim."""

    id = models.BigAutoField(primary_key=True)
    dataset = models.ForeignKey(
        "datasets.Dataset", on_delete=models.CASCADE, related_name="raw_transactions"
    )
    import_record = models.ForeignKey(
        "datasets.DatasetImport",
        on_delete=models.CASCADE,
        related_name="raw_transactions",
    )
    row_number = models.PositiveIntegerField()
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "raw_transactions"
        ordering = ["row_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["dataset", "row_number"], name="unique_raw_row_per_dataset"
            )
        ]

    def __str__(self) -> str:
        return f"{self.dataset_id} row {self.row_number}"


class DimDate(models.Model):
    date = models.DateField(unique=True)
    year = models.PositiveSmallIntegerField()
    quarter = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()
    day = models.PositiveSmallIntegerField()
    iso_year = models.PositiveSmallIntegerField()
    iso_week = models.PositiveSmallIntegerField()
    day_of_week = models.PositiveSmallIntegerField()

    class Meta:
        db_table = "dim_date"
        ordering = ["date"]

    def __str__(self) -> str:
        return self.date.isoformat()


class DimCustomer(models.Model):
    dataset = models.ForeignKey(
        "datasets.Dataset", on_delete=models.CASCADE, related_name="customers"
    )
    source_customer_id = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "dim_customer"
        constraints = [
            models.UniqueConstraint(
                fields=["dataset", "source_customer_id"],
                name="unique_customer_per_dataset",
            )
        ]

    def __str__(self) -> str:
        return self.source_customer_id


class DimProduct(models.Model):
    dataset = models.ForeignKey(
        "datasets.Dataset", on_delete=models.CASCADE, related_name="products"
    )
    source_product_code = models.CharField(max_length=128)
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "dim_product"
        constraints = [
            models.UniqueConstraint(
                fields=["dataset", "source_product_code"],
                name="unique_product_per_dataset",
            )
        ]

    def __str__(self) -> str:
        return self.source_product_code


class DimGeography(models.Model):
    dataset = models.ForeignKey(
        "datasets.Dataset", on_delete=models.CASCADE, related_name="geographies"
    )
    country = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "dim_geography"
        constraints = [
            models.UniqueConstraint(
                fields=["dataset", "country"], name="unique_country_per_dataset"
            )
        ]

    def __str__(self) -> str:
        return self.country


class FactSales(models.Model):
    dataset = models.ForeignKey(
        "datasets.Dataset", on_delete=models.CASCADE, related_name="sales_lines"
    )
    import_record = models.ForeignKey(
        "datasets.DatasetImport",
        on_delete=models.CASCADE,
        related_name="sales_lines",
    )
    date_key = models.ForeignKey(DimDate, on_delete=models.PROTECT, related_name="+")
    customer_key = models.ForeignKey(
        DimCustomer,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    product_key = models.ForeignKey(DimProduct, on_delete=models.PROTECT, related_name="+")
    geography_key = models.ForeignKey(
        DimGeography,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    quantity = models.IntegerField()
    unit_price = models.DecimalField(max_digits=12, decimal_places=4)
    gross_line_amount = models.DecimalField(max_digits=14, decimal_places=4)
    discount_amount = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    net_line_amount = models.DecimalField(max_digits=14, decimal_places=4)
    source_invoice_id = models.CharField(max_length=128)
    source_line_identifier = models.CharField(max_length=128)
    source_row_number = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "fact_sales"
        ordering = ["source_row_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["dataset", "source_invoice_id", "source_line_identifier"],
                name="unique_sales_line",
            ),
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name="sales_quantity_positive",
            ),
        ]
        indexes = [models.Index(fields=["dataset", "date_key"])]

    def __str__(self) -> str:
        return f"{self.source_invoice_id}/{self.source_line_identifier}"


class FactReturn(models.Model):
    dataset = models.ForeignKey(
        "datasets.Dataset", on_delete=models.CASCADE, related_name="return_lines"
    )
    import_record = models.ForeignKey(
        "datasets.DatasetImport",
        on_delete=models.CASCADE,
        related_name="return_lines",
    )
    date_key = models.ForeignKey(DimDate, on_delete=models.PROTECT, related_name="+")
    customer_key = models.ForeignKey(
        DimCustomer,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    product_key = models.ForeignKey(DimProduct, on_delete=models.PROTECT, related_name="+")
    geography_key = models.ForeignKey(
        DimGeography,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    quantity = models.IntegerField()
    unit_price = models.DecimalField(max_digits=12, decimal_places=4)
    gross_line_amount = models.DecimalField(max_digits=14, decimal_places=4)
    discount_amount = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    net_line_amount = models.DecimalField(max_digits=14, decimal_places=4)
    source_invoice_id = models.CharField(max_length=128)
    source_line_identifier = models.CharField(max_length=128)
    source_row_number = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "fact_returns"
        ordering = ["source_row_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["dataset", "source_invoice_id", "source_line_identifier"],
                name="unique_return_line",
            ),
            models.CheckConstraint(
                condition=models.Q(quantity__lt=0),
                name="return_quantity_negative",
            ),
        ]
        indexes = [models.Index(fields=["dataset", "date_key"])]

    def __str__(self) -> str:
        return f"{self.source_invoice_id}/{self.source_line_identifier}"
