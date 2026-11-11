"""Response schemas for the analytics endpoints.

Every view in this app returns a payload assembled by ``analytics.services`` or
``analytics.extended`` rather than a model serializer, so these classes describe
those payloads for the OpenAPI schema. They document the response; the services
remain the single source of truth for the numbers.
"""

from rest_framework import serializers

from config.schema import date_field, money_field, rate_field


class DatasetRefSerializer(serializers.Serializer):
    """One dataset a payload was computed from."""

    id = serializers.CharField()
    name = serializers.CharField()


class SalesSummarySerializer(serializers.Serializer):
    """Headline sales KPIs with their resolved periods."""

    has_data = serializers.BooleanField()
    date_from = date_field()
    date_to = date_field()
    compare = serializers.CharField(allow_null=True, required=False)
    comparison_date_from = date_field()
    comparison_date_to = date_field()
    gross_sales = money_field()
    net_sales = money_field()
    eligible_orders = serializers.IntegerField()
    average_order_value = money_field(allow_null=True)
    unique_customers = serializers.IntegerField()
    sales_growth_percent = rate_field()
    previous_net_sales = money_field()
    datasets = DatasetRefSerializer(many=True)


class TrendPointSerializer(serializers.Serializer):
    """Net sales and distinct orders for one day, ISO week or month."""

    period_start = date_field()
    period_end = date_field()
    label = serializers.CharField()
    gross_sales = money_field()
    net_sales = money_field()
    orders = serializers.IntegerField()


class TrendComparisonSerializer(serializers.Serializer):
    """The same series for the baseline window, aligned by position."""

    date_from = date_field()
    date_to = date_field()
    points = TrendPointSerializer(many=True)


class SalesTrendSerializer(serializers.Serializer):
    granularity = serializers.CharField()
    has_data = serializers.BooleanField()
    date_from = date_field()
    date_to = date_field()
    compare = serializers.CharField(allow_null=True)
    comparison = TrendComparisonSerializer(allow_null=True)
    points = TrendPointSerializer(many=True)


class ProductRowSerializer(serializers.Serializer):
    """One product's revenue, units and period-over-period direction."""

    product_id = serializers.CharField()
    source_product_code = serializers.CharField()
    description = serializers.CharField(allow_null=True)
    dataset_id = serializers.CharField()
    dataset_name = serializers.CharField()
    net_sales = money_field()
    gross_sales = money_field()
    share = rate_field()
    units = serializers.IntegerField()
    orders = serializers.IntegerField()
    returned_units = serializers.IntegerField()
    return_lines = serializers.IntegerField()
    previous_net_sales = money_field()
    change_percent = rate_field()
    direction = serializers.CharField()


class ProductSummarySerializer(serializers.Serializer):
    """Period totals across the ranked product rows."""

    has_data = serializers.BooleanField()
    compare = serializers.CharField(allow_null=True, required=False)
    date_from = date_field()
    date_to = date_field()
    comparison_date_from = date_field()
    comparison_date_to = date_field()
    net_sales = money_field()
    product_count = serializers.IntegerField()
    top_product_share = rate_field()
    declining_products = serializers.IntegerField()
    rows = ProductRowSerializer(many=True)


class GeographyRowSerializer(serializers.Serializer):
    """One country's revenue, orders and return rate."""

    country = serializers.CharField()
    net_sales = money_field()
    gross_sales = money_field()
    discount_total = money_field()
    share = rate_field()
    units = serializers.IntegerField()
    orders = serializers.IntegerField()
    customers = serializers.IntegerField()
    returned_units = serializers.IntegerField()
    return_value = money_field()
    return_rate = rate_field()
    previous_net_sales = money_field()
    change_percent = rate_field()
    direction = serializers.CharField()


class GeographySummarySerializer(serializers.Serializer):
    """Period totals across the ranked country rows."""

    has_data = serializers.BooleanField()
    compare = serializers.CharField(allow_null=True, required=False)
    date_from = date_field()
    date_to = date_field()
    comparison_date_from = date_field()
    comparison_date_to = date_field()
    net_sales = money_field()
    country_count = serializers.IntegerField()
    top_country_share = rate_field()
    rows = GeographyRowSerializer(many=True)


class ReturnBridgeSerializer(serializers.Serializer):
    """One step of the gross-to-net bridge."""

    label = serializers.CharField()
    amount = money_field()


class ReturnProductSerializer(serializers.Serializer):
    product_id = serializers.CharField()
    source_product_code = serializers.CharField()
    description = serializers.CharField(allow_null=True)
    dataset_id = serializers.CharField()
    dataset_name = serializers.CharField()
    returned_units = serializers.IntegerField()
    return_lines = serializers.IntegerField()
    return_value = money_field()
    sold_units = serializers.IntegerField()
    return_rate = rate_field()
    net_sales = money_field()


class ReturnCountrySerializer(serializers.Serializer):
    country = serializers.CharField()
    sold_units = serializers.IntegerField()
    returned_units = serializers.IntegerField()
    return_value = money_field()
    return_rate = rate_field()


class ReturnsAnalysisSerializer(serializers.Serializer):
    """Return rates, discount depth and the gross-to-net bridge."""

    has_data = serializers.BooleanField()
    date_from = date_field()
    date_to = date_field()
    sales_lines = serializers.IntegerField()
    return_lines = serializers.IntegerField()
    sold_units = serializers.IntegerField()
    returned_units = serializers.IntegerField()
    return_rate = rate_field()
    gross_sales = money_field()
    discount_total = money_field()
    discount_rate = rate_field()
    return_value = money_field()
    net_sales = money_field()
    bridge = ReturnBridgeSerializer(many=True)
    products = ReturnProductSerializer(many=True)
    countries = ReturnCountrySerializer(many=True)


class BasketProductSerializer(serializers.Serializer):
    """One side of a co-purchased product pair."""

    product_id = serializers.CharField()
    source_product_code = serializers.CharField()
    description = serializers.CharField(allow_null=True)


class BasketPairSerializer(serializers.Serializer):
    product_a = BasketProductSerializer()
    product_b = BasketProductSerializer()
    invoices = serializers.IntegerField()
    support = rate_field()
    confidence_a_to_b = rate_field()
    confidence_b_to_a = rate_field()
    lift = serializers.CharField(allow_null=True)


class BasketAnalysisSerializer(serializers.Serializer):
    """Products bought on the same invoice, ranked by co-occurrence."""

    has_data = serializers.BooleanField()
    date_from = date_field()
    date_to = date_field()
    invoices = serializers.IntegerField()
    pairs = BasketPairSerializer(many=True)


class ProductHeaderSerializer(serializers.Serializer):
    """The dimension row a product detail belongs to."""

    product_id = serializers.CharField()
    source_product_code = serializers.CharField()
    description = serializers.CharField(allow_null=True)
    dataset_id = serializers.CharField()
    dataset_name = serializers.CharField()


class ProductTrendSerializer(serializers.Serializer):
    month = serializers.CharField()
    label = serializers.CharField()
    net_sales = money_field()
    units = serializers.IntegerField()
    orders = serializers.IntegerField()
    returned_units = serializers.IntegerField()


class ProductCustomerSerializer(serializers.Serializer):
    customer_id = serializers.CharField()
    source_customer_id = serializers.CharField()
    net_sales = money_field()
    orders = serializers.IntegerField()
    last_purchase = date_field()


class ProductCountrySerializer(serializers.Serializer):
    country = serializers.CharField()
    net_sales = money_field()
    units = serializers.IntegerField()


class ProductDetailSerializer(serializers.Serializer):
    """One product's performance, its trend, buyers and countries."""

    has_data = serializers.BooleanField()
    compare = serializers.CharField(allow_null=True, required=False)
    product = ProductHeaderSerializer(allow_null=True)
    date_from = date_field()
    date_to = date_field()
    comparison_date_from = date_field()
    comparison_date_to = date_field()
    net_sales = money_field()
    gross_sales = money_field()
    units = serializers.IntegerField()
    orders = serializers.IntegerField()
    returned_units = serializers.IntegerField()
    return_rate = rate_field()
    share = rate_field()
    previous_net_sales = money_field()
    change_percent = rate_field()
    trend = ProductTrendSerializer(many=True)
    customers = ProductCustomerSerializer(many=True)
    countries = ProductCountrySerializer(many=True)
