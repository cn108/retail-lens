"""Response schemas and segment bodies for the customer endpoints.

The analytical payloads come from ``customers.services`` and
``customers.extended``; the segment serializers describe the request bodies the
segment views validate by hand so that non-ASCII keys and rule sets are checked
in one place.
"""

from rest_framework import serializers

from config.schema import date_field, money_field, rate_field


class CustomerSummarySerializer(serializers.Serializer):
    """Repeat-purchase and historical-value measures for the period."""

    has_data = serializers.BooleanField()
    date_from = date_field()
    date_to = date_field()
    identifiable_customers = serializers.IntegerField()
    repeat_customers = serializers.IntegerField()
    repeat_purchase_rate = rate_field()
    average_orders = rate_field()
    historical_value = money_field()
    average_historical_value = money_field()
    month_1_retention = rate_field()
    cohort_count = serializers.IntegerField()


class RfmCustomerSerializer(serializers.Serializer):
    """One customer's recency, frequency, monetary score and segment."""

    customer_id = serializers.CharField()
    source_customer_id = serializers.CharField()
    dataset_id = serializers.CharField()
    dataset_name = serializers.CharField()
    last_purchase = date_field()
    recency_days = serializers.IntegerField()
    orders = serializers.IntegerField()
    net_sales = money_field()
    r = serializers.IntegerField(allow_null=True)
    f = serializers.IntegerField(allow_null=True)
    m = serializers.IntegerField(allow_null=True)
    segment = serializers.CharField()
    segment_label = serializers.CharField()


class RfmSegmentSerializer(serializers.Serializer):
    """RFM segment totals, ordered by net sales."""

    key = serializers.CharField()
    label = serializers.CharField()
    customers = serializers.IntegerField()
    net_sales = money_field()
    share = rate_field()


class CustomerRfmSerializer(serializers.Serializer):
    """A page of scored customers plus the segment totals behind it."""

    has_data = serializers.BooleanField()
    date_from = date_field()
    date_to = date_field()
    as_of = date_field()
    customers = RfmCustomerSerializer(many=True)
    segments = RfmSegmentSerializer(many=True)
    total = serializers.IntegerField()
    offset = serializers.IntegerField()
    sort = serializers.CharField()
    segment = serializers.CharField(allow_null=True)


class RetentionMonthSerializer(serializers.Serializer):
    month_offset = serializers.IntegerField()
    month = serializers.CharField()
    customers = serializers.IntegerField()
    rate = rate_field()


class RetentionCohortSerializer(serializers.Serializer):
    cohort = serializers.CharField()
    size = serializers.IntegerField()
    months = RetentionMonthSerializer(many=True)


class CustomerRetentionSerializer(serializers.Serializer):
    """First-month retention and the monthly cohort grid."""

    has_data = serializers.BooleanField()
    date_from = date_field()
    date_to = date_field()
    month_1_retention = rate_field()
    cohorts = RetentionCohortSerializer(many=True)


class CustomerHeaderSerializer(serializers.Serializer):
    """The customer dimension row a detail payload belongs to."""

    customer_id = serializers.CharField()
    source_customer_id = serializers.CharField()
    dataset_id = serializers.CharField()
    dataset_name = serializers.CharField()


class CustomerTimelineSerializer(serializers.Serializer):
    invoice = serializers.CharField()
    date = date_field()
    net_sales = money_field()
    lines = serializers.IntegerField()
    units = serializers.IntegerField()


class CustomerProductSerializer(serializers.Serializer):
    product_id = serializers.CharField()
    source_product_code = serializers.CharField()
    description = serializers.CharField(allow_null=True)
    net_sales = money_field()
    units = serializers.IntegerField()
    orders = serializers.IntegerField()


class CustomerDetailSerializer(serializers.Serializer):
    """One customer's value, score, recent invoices and products."""

    has_data = serializers.BooleanField()
    customer = CustomerHeaderSerializer(allow_null=True)
    date_from = date_field()
    date_to = date_field()
    orders = serializers.IntegerField()
    net_sales = money_field()
    first_purchase = date_field()
    last_purchase = date_field()
    average_order_value = money_field(allow_null=True)
    share_of_net_sales = rate_field()
    segment = serializers.CharField(allow_null=True)
    segment_label = serializers.CharField(allow_null=True)
    recency_days = serializers.IntegerField(allow_null=True)
    r = serializers.IntegerField(allow_null=True)
    f = serializers.IntegerField(allow_null=True)
    m = serializers.IntegerField(allow_null=True)
    selection_average_net_sales = money_field(allow_null=True)
    timeline = CustomerTimelineSerializer(many=True)
    products = CustomerProductSerializer(many=True)


class SegmentSerializer(serializers.Serializer):
    """A saved customer segment."""

    id = serializers.CharField()
    name = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    dataset = serializers.CharField(allow_null=True)
    rules = serializers.DictField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class SegmentListSerializer(serializers.Serializer):
    segments = SegmentSerializer(many=True)


class SegmentWriteSerializer(serializers.Serializer):
    """The body accepted when creating a segment."""

    name = serializers.CharField(max_length=120)
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    dataset = serializers.UUIDField(required=False, allow_null=True)
    rules = serializers.DictField(
        required=False,
        help_text=(
            "Rule set matched against RFM rows. Supported keys: recency_days_max, "
            "recency_days_min, orders_min, rfm_score_min, net_sales_min."
        ),
    )


class SegmentUpdateSerializer(SegmentWriteSerializer):
    """The subset of a segment that PATCH accepts."""

    name = serializers.CharField(max_length=120, required=False)


class SegmentMemberSerializer(serializers.Serializer):
    """One customer matched by a segment's rules."""

    customer_id = serializers.CharField()
    source_customer_id = serializers.CharField()
    dataset_id = serializers.CharField()
    dataset_name = serializers.CharField()
    segment = serializers.CharField()
    segment_label = serializers.CharField()
    recency_days = serializers.IntegerField(allow_null=True)
    orders = serializers.IntegerField()
    net_sales = money_field()
    last_purchase = date_field()


class SegmentMembersSerializer(serializers.Serializer):
    has_data = serializers.BooleanField()
    date_from = date_field()
    date_to = date_field()
    total = serializers.IntegerField()
    net_sales = money_field()
    customers = SegmentMemberSerializer(many=True)
