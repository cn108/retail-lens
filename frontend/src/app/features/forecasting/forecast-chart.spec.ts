import { FORECAST_CHART_HEIGHT, FORECAST_CHART_WIDTH, buildForecastChart } from './forecast-chart';

const history = [
  { period: '2025-09-01', amount: '100.0000' },
  { period: '2025-10-01', amount: '200.0000' },
  { period: '2025-11-01', amount: '300.0000' },
];

const forecast = [
  {
    target_date: '2025-12-01',
    predicted_amount: '350.0000',
    lower_bound: '300.0000',
    upper_bound: '400.0000',
  },
  {
    target_date: '2026-01-01',
    predicted_amount: '400.0000',
    lower_bound: '320.0000',
    upper_bound: '480.0000',
  },
];

describe('buildForecastChart', () => {
  it('returns an empty chart when there is nothing to plot', () => {
    const chart = buildForecastChart([], []);

    expect(chart.historyPoints).toEqual([]);
    expect(chart.forecastPoints).toEqual([]);
    expect(chart.historyLine).toBe('');
    expect(chart.forecastLine).toBe('');
    expect(chart.band).toBe('');
    expect(chart.width).toBe(FORECAST_CHART_WIDTH);
    expect(chart.height).toBe(FORECAST_CHART_HEIGHT);
  });

  it('places observed months before forecast months on one time axis', () => {
    const chart = buildForecastChart(history, forecast);

    expect(chart.historyPoints).toHaveLength(3);
    expect(chart.forecastPoints).toHaveLength(2);
    expect(chart.forecastPoints[0].x).toBeGreaterThan(
      chart.historyPoints[chart.historyPoints.length - 1].x,
    );
    expect(chart.forecastPoints[1].x).toBe(chart.right);
    expect(chart.historyPoints[0].x).toBe(chart.left);
  });

  it('keeps every point inside the plot area', () => {
    const chart = buildForecastChart(history, forecast);
    const points = [...chart.historyPoints, ...chart.forecastPoints];

    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(chart.left);
      expect(point.x).toBeLessThanOrEqual(chart.right);
      expect(point.y).toBeGreaterThanOrEqual(chart.top);
      expect(point.y).toBeLessThanOrEqual(chart.bottom);
    }
  });

  it('draws the interval band around the forecast and a dashed forecast path', () => {
    const chart = buildForecastChart(history, forecast);

    expect(chart.band.startsWith('M')).toBe(true);
    expect(chart.band.endsWith('Z')).toBe(true);
    expect(chart.forecastLine.split('L')).toHaveLength(3);
    expect(chart.forecastLine.startsWith('M')).toBe(true);
  });

  it('orders the y axis from the maximum value down to zero', () => {
    const chart = buildForecastChart(history, forecast);

    expect(chart.ticks.length).toBeGreaterThanOrEqual(2);
    expect(chart.ticks[0].value).toBe(480);
    expect(chart.ticks[0].y).toBeLessThan(chart.ticks[chart.ticks.length - 1].y);
    expect(chart.ticks[chart.ticks.length - 1].value).toBe(0);
  });

  it('labels the first and last periods of the combined series', () => {
    const chart = buildForecastChart(history, forecast);

    expect(chart.labels).toHaveLength(5);
    expect(chart.labels[0].anchor).toBe('start');
    expect(chart.labels[chart.labels.length - 1].anchor).toBe('end');
    expect(chart.labels[0].text).toContain('2025');
  });

  it('plots history alone while a run is still queued', () => {
    const chart = buildForecastChart(history, []);

    expect(chart.historyPoints).toHaveLength(3);
    expect(chart.forecastPoints).toHaveLength(0);
    expect(chart.forecastLine).toBe('');
    expect(chart.band).toBe('');
  });
});
