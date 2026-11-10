import { SalesTrendPoint } from '../../core/api/analytics.service';

export const CHART_WIDTH = 680;
export const CHART_HEIGHT = 260;
const PADDING_TOP = 16;
const PADDING_RIGHT = 12;
const PADDING_BOTTOM = 32;
const PADDING_LEFT = 56;

export interface ChartPoint {
  x: number;
  y: number;
  value: number;
  label: string;
}

export interface ChartTick {
  y: number;
  value: number;
  label: string;
}

export interface ChartLabel {
  x: number;
  y: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
}

export interface TrendChart {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  zeroY: number;
  line: string;
  area: string;
  points: ChartPoint[];
  ticks: ChartTick[];
  labels: ChartLabel[];
}

const EMPTY: TrendChart = {
  width: CHART_WIDTH,
  height: CHART_HEIGHT,
  left: PADDING_LEFT,
  right: CHART_WIDTH - PADDING_RIGHT,
  top: PADDING_TOP,
  bottom: CHART_HEIGHT - PADDING_BOTTOM,
  zeroY: CHART_HEIGHT - PADDING_BOTTOM,
  line: '',
  area: '',
  points: [],
  ticks: [],
  labels: [],
};

function tickLabel(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(Math.round(value));
  }
}

function labelIndices(length: number): number[] {
  if (length <= 4) {
    return Array.from({ length }, (_, index) => index);
  }
  const step = (length - 1) / 3;
  return [...new Set([0, Math.round(step), Math.round(step * 2), length - 1])].sort(
    (a, b) => a - b,
  );
}

/**
 * Build an SVG line/area chart for net-sales trend points. The domain always
 * includes zero so returns (negative values) sit below the baseline.
 */
export function buildTrendChart(
  points: SalesTrendPoint[],
  currency = 'GBP',
): TrendChart {
  if (!points.length) {
    return EMPTY;
  }

  const values = points.map((point) => Number(point.net_sales) || 0);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const plotWidth = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const xFor = (index: number): number =>
    points.length === 1
      ? PADDING_LEFT + plotWidth / 2
      : PADDING_LEFT + (index / (points.length - 1)) * plotWidth;
  const yFor = (value: number): number =>
    PADDING_TOP + ((max - value) / span) * plotHeight;

  const chartPoints: ChartPoint[] = points.map((point, index) => ({
    x: xFor(index),
    y: yFor(values[index]),
    value: values[index],
    label: point.label,
  }));

  const line = chartPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
  const zeroY = yFor(0);
  const area =
    chartPoints.length > 1
      ? [
          `M${chartPoints[0].x.toFixed(2)},${zeroY.toFixed(2)}`,
          ...chartPoints.map((point) => `L${point.x.toFixed(2)},${point.y.toFixed(2)}`),
          `L${chartPoints[chartPoints.length - 1].x.toFixed(2)},${zeroY.toFixed(2)}`,
          'Z',
        ].join(' ')
      : '';

  const tickValues = [max, 0, min].filter(
    (value, index, all) => all.indexOf(value) === index,
  );
  const ticks: ChartTick[] = tickValues.map((value) => ({
    y: yFor(value),
    value,
    label: tickLabel(value, currency),
  }));

  const labels: ChartLabel[] = labelIndices(points.length).map((index) => ({
    x: xFor(index),
    y: CHART_HEIGHT - 8,
    text: points[index].label,
    anchor:
      points.length === 1
        ? 'middle'
        : index === 0
          ? 'start'
          : index === points.length - 1
            ? 'end'
            : 'middle',
  }));

  return {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    left: PADDING_LEFT,
    right: CHART_WIDTH - PADDING_RIGHT,
    top: PADDING_TOP,
    bottom: CHART_HEIGHT - PADDING_BOTTOM,
    zeroY,
    line,
    area,
    points: chartPoints,
    ticks,
    labels,
  };
}
