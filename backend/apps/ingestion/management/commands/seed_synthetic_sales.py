"""Seed one organisation with a forecastable synthetic sales history.

The command takes the same path a real upload does: it writes a CSV, inspects
it, maps every column by the canonical aliases, and runs the ETL. Nothing is
inserted straight into the warehouse, so the resulting dataset behaves exactly
like a processed upload on every page in the app.
"""

from __future__ import annotations

import uuid
from datetime import date

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.exceptions import APIException

from apps.datasets.models import Dataset
from apps.datasets.services import apply_mapping, create_dataset, delete_dataset
from apps.forecasting.services import monthly_series
from apps.ingestion.canonical import suggest_canonical_field
from apps.ingestion.etl import run_processing
from apps.ingestion.models import ProcessingLog
from apps.ingestion.synthetic import add_months, build_transactions, to_csv
from apps.organisations.models import ROLE_RANK, Membership, Organisation

DEFAULT_NAME = "synthetic-two-years"
MIN_MONTHS = 12
MAX_MONTHS = 60


def _error_detail(error: APIException) -> str:
    detail = getattr(error, "detail", error)
    return detail if isinstance(detail, str) else str(detail)


class Command(BaseCommand):
    help = (
        "Generate a synthetic multi-year sales history for one organisation and "
        "process it, so forecasting and the analysis pages have data to work on."
    )

    def add_arguments(self, parser):  # type: ignore[no-untyped-def]
        parser.add_argument(
            "--organisation",
            default="",
            help="Organisation name or id. Required when the database has more than one.",
        )
        parser.add_argument(
            "--name",
            default=DEFAULT_NAME,
            help=f"Dataset name to create (default: {DEFAULT_NAME}).",
        )
        parser.add_argument(
            "--months",
            type=int,
            default=24,
            help="Whole months of history to generate, ending last month (default: 24).",
        )
        parser.add_argument(
            "--orders-per-day",
            type=int,
            default=6,
            help="Average invoices per day before seasonality (default: 6).",
        )
        parser.add_argument(
            "--seed",
            type=int,
            default=20240101,
            help="Random seed; the same seed always produces the same file (default: 20240101).",
        )
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete an existing dataset with the same name in the organisation first.",
        )

    def handle(self, *args, **options):  # type: ignore[no-untyped-def]
        months = options["months"]
        if not MIN_MONTHS <= months <= MAX_MONTHS:
            raise CommandError(f"--months must be between {MIN_MONTHS} and {MAX_MONTHS}.")
        orders_per_day = options["orders_per_day"]
        if orders_per_day < 1:
            raise CommandError("--orders-per-day must be at least 1.")

        organisation = self._organisation(options["organisation"])
        membership = self._membership(organisation)
        name = options["name"].strip() or DEFAULT_NAME

        existing = Dataset.objects.filter(organisation=organisation, name=name).first()
        if existing is not None:
            if not options["replace"]:
                raise CommandError(
                    f"'{organisation.name}' already has a dataset named '{name}'. "
                    "Re-run with --replace to rebuild it, or pass --name."
                )
            delete_dataset(existing)
            self.stdout.write(f"Removed the existing dataset '{name}'.")

        start = add_months(date_of_last_month(), -(months - 1))
        history = build_transactions(
            start=start,
            months=months,
            orders_per_day=orders_per_day,
            seed=options["seed"],
        )
        payload = to_csv(history.rows)
        uploaded = ContentFile(payload.encode("utf-8"), name=f"{slugify(name) or 'dataset'}.csv")

        try:
            dataset = create_dataset(membership=membership, uploaded_file=uploaded, name=name)
            mapping = {
                str(column.id): suggest_canonical_field(column.source_name)
                for column in dataset.current_import.columns.all()
            }
            apply_mapping(dataset=dataset, mapping=mapping)
        except APIException as error:
            raise CommandError(_error_detail(error)) from error

        # The worker may not be running while someone seeds a local workspace,
        # and run_processing is documented as safe to call synchronously.
        run = ProcessingLog.objects.create(dataset=dataset, created_by=membership.user)
        outcome = run_processing(str(run.id))
        run.refresh_from_db()
        if outcome != "succeeded":
            raise CommandError(f"Processing failed: {run.error_message}")
        dataset.refresh_from_db()

        periods = len(monthly_series(organisation, dataset))
        self.stdout.write(
            self.style.SUCCESS(f"Seeded '{dataset.name}' in {organisation.name} ({dataset.id}).")
        )
        self.stdout.write(
            f"  window     {history.start} to {history.end} ({periods} monthly periods)"
        )
        self.stdout.write(
            f"  rows       {run.rows_read} read, {run.rows_loaded} loaded, "
            f"{run.rows_rejected} rejected"
        )
        summary = run.summary or {}
        self.stdout.write(
            f"  warehouse  {summary.get('sales_rows', 0)} sales lines, "
            f"{summary.get('return_rows', 0)} return lines, "
            f"{summary.get('products', 0)} products, "
            f"{summary.get('customers', 0)} customers, "
            f"{summary.get('countries', 0)} countries"
        )
        for anomaly in history.anomalies:
            self.stdout.write(
                f"  injected   {anomaly.kind} {anomaly.start} to {anomaly.end} "
                f"at {anomaly.multiplier:g}x normal volume"
            )
        self.stdout.write("Open Forecasting and start a run; both disruptions are in the history.")

    def _organisation(self, value: str) -> Organisation:
        organisations = Organisation.objects.all()
        if not organisations.exists():
            raise CommandError("No organisation exists yet. Register an account in the app first.")

        if value:
            organisation = None
            try:
                organisation = organisations.filter(id=uuid.UUID(value)).first()
            except ValueError:
                organisation = None
            if organisation is None:
                matches = list(organisations.filter(name__iexact=value))
                if len(matches) != 1:
                    raise CommandError(
                        f"No single organisation matches '{value}'. "
                        f"Available: {', '.join(organisations.values_list('name', flat=True))}."
                    )
                organisation = matches[0]
            return organisation

        if organisations.count() > 1:
            raise CommandError(
                "Several organisations exist; pass --organisation. "
                f"Available: {', '.join(organisations.values_list('name', flat=True))}."
            )
        return organisations.first()

    def _membership(self, organisation: Organisation) -> Membership:
        memberships = list(
            Membership.objects.filter(organisation=organisation).select_related("user")
        )
        if not memberships:
            raise CommandError(f"'{organisation.name}' has no members to attribute the dataset to.")
        return max(memberships, key=lambda membership: ROLE_RANK.get(membership.role, 0))


def date_of_last_month() -> date:
    """First day of the last complete month, so the window has no partial month."""
    today = timezone.localdate()
    return add_months(date(today.year, today.month, 1), -1)
