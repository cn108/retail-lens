import { ForecastHistoryPoint, ForecastPoint } from '../../core/api/forecasting.service';

export const FORECAST_CHART_WIDTH = 720;
export const FORECAST_CHART_HEIGHT = 280;
const PADDING_TOP = 16;
const PADDING_RIGHT = 14;
const PADDING_BOTTOM = 32;
const PADDING_LEFT = 58;

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

export interface ForecastChart {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  historyLine: string;
  forecastLine: string;
  band: string;
  historyPoints: ChartPoint[];
  forecastPoints: (ChartPoint & { lower: number; upper: number })[];
  ticks: ChartTick[];
  labels: ChartLabel[];
}

const EMPTY: ForecastChart = {
  width: FORECAST_CHART_WIDTH,
  height: FORECAST_CHART_HEIGHT,
  left: PADDING_LEFT,
  right: FORECAST_CHART_WIDTH - PADDING_RIGHT,
  top: PADDING_TOP,
  bottom: FORECAST_CHART_HEIGHT - PADDING_BOTTOM,
  historyLine: '',
  forecastLine: '',
  band: '',
  historyPoints: [],
  forecastPoints: [],
  ticks: [],
  labels: [],
};

function monthLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

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
  if (length <= 5) {
    return Array.from({ length }, (_, index) => index);
  }
  const step = (length - 1) / 4;
  return [
    ...new Set([0, Math.round(step), Math.round(step * 2), Math.round(step * 3), length - 1]),
  ].sort((a, b) => a - b);
}

/** Build an SVG chart for observed monthly sales plus forecast and its band. */
export function buildForecastChart(
  history: ForecastHistoryPoint[],
  forecast: ForecastPoint[],
  currency = 'GBP',
): ForecastChart {
  if (!history.length && !forecast.length) {
    return EMPTY;
  }

  const historyValues = history.map((point) => Number(point.amount) || 0);
  const forecastValues = forecast.map((point) => Number(point.predicted_amount) || 0);
  const allValues = [
    ...historyValues,
    ...forecastValues,
    ...forecast.map((point) => Number(point.lower_bound) || 0),
    ...forecast.map((point) => Number(point.upper_bound) || 0),
  ];
  const min = Math.min(0, ...allValues);
  const max = Math.max(0, ...allValues);
  const span = max - min || 1;
  const plotWidth = FORECAST_CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = FORECAST_CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const total = history.length + forecast.length;

  const xFor = (index: number): number =>
    total <= 1 ? PADDING_LEFT + plotWidth / 2 : PADDING_LEFT + (index / (total - 1)) * plotWidth;
  const yFor = (value: number): number => PADDING_TOP + ((max - value) / span) * plotHeight;

  const historyPoints: ChartPoint[] = history.map((point, index) => ({
    x: xFor(index),
    y: yFor(historyValues[index]),
    value: historyValues[index],
    label: monthLabel(point.period),
  }));

  const forecastStart = history.length ? history.length - 1 : 0;
  const forecastPoints = forecast.map((point, index) => ({
    x: xFor(forecastStart + index + (history.length ? 1 : 0)),
    y: yFor(forecastValues[index]),
    value: forecastValues[index],
    lower: Number(point.lower_bound) || 0,
    upper: Number(point.upper_bound) || 0,
    label: monthLabel(point.target_date),
  }));

  const historyLine = historyPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');

  const forecastPath = [
    ...(historyPoints.length
      ? [
          {
            x: historyPoints[historyPoints.length - 1].x,
            y: historyPoints[historyPoints.length - 1].y,
          },
        ]
      : []),
    ...forecastPoints,
  ];
  const forecastLine = forecastPoints.length
    ? forecastPath
        .map(
          (point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`,
        )
        .join(' ')
    : '';

  const band = forecastPoints.length
    ? [
        ...forecastPoints.map(
          (point, index) =>
            `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${yFor(point.upper).toFixed(2)}`,
        ),
        ...[...forecastPoints]
          .reverse()
          .map((point) => `L${point.x.toFixed(2)},${yFor(point.lower).toFixed(2)}`),
        'Z',
      ].join(' ')
    : '';

  const tickValues = [max, 0, min].filter((value, index, all) => all.indexOf(value) === index);
  const ticks: ChartTick[] = tickValues.map((value) => ({
    y: yFor(value),
    value,
    label: tickLabel(value, currency),
  }));

  const combinedLabels = [
    ...history.map((point) => monthLabel(point.period)),
    ...forecast.map((point) => monthLabel(point.target_date)),
  ];
  const labels: ChartLabel[] = labelIndices(total).map((index) => ({
    x: xFor(index),
    y: FORECAST_CHART_HEIGHT - 8,
    text: combinedLabels[index],
    anchor: total === 1 ? 'middle' : index === 0 ? 'start' : index === total - 1 ? 'end' : 'middle',
  }));

  return {
    width: FORECAST_CHART_WIDTH,
    height: FORECAST_CHART_HEIGHT,
    left: PADDING_LEFT,
    right: FORECAST_CHART_WIDTH - PADDING_RIGHT,
    top: PADDING_TOP,
    bottom: FORECAST_CHART_HEIGHT - PADDING_BOTTOM,
    historyLine,
    forecastLine,
    band,
    historyPoints,
    forecastPoints,
    ticks,
    labels,
  };
}
