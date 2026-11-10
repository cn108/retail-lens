import { CHART_HEIGHT, CHART_WIDTH, buildTrendChart } from './trend-chart';
import { SalesTrendPoint } from '../../core/api/analytics.service';

function point(label: string, net: string): SalesTrendPoint {
  return {
    period_start: '2024-01-01',
    period_end: '2024-01-31',
    label,
    gross_sales: net,
    net_sales: net,
    orders: 1,
  };
}

describe('buildTrendChart', () => {
  it('returns an empty chart when there are no points', () => {
    const chart = buildTrendChart([]);

    expect(chart.width).toBe(CHART_WIDTH);
    expect(chart.height).toBe(CHART_HEIGHT);
    expect(chart.points).toEqual([]);
    expect(chart.ticks).toEqual([]);
    expect(chart.labels).toEqual([]);
    expect(chart.line).toBe('');
    expect(chart.area).toBe('');
  });

  it('keeps zero inside a domain that includes returns', () => {
    const chart = buildTrendChart([point('Jan', '40.00'), point('Feb', '-10.00')]);

    expect(chart.zeroY).toBeGreaterThan(chart.points[0].y);
    expect(chart.zeroY).toBeLessThan(chart.points[1].y);
    expect(chart.ticks.map((tick) => tick.value)).toEqual([40, 0, -10]);
    expect(chart.points[0].x).toBeLessThan(chart.points[1].x);
    expect(chart.line.startsWith('M')).toBe(true);
    expect(chart.line).toContain('L');
    expect(chart.area.endsWith('Z')).toBe(true);
  });

  it('centres a single period and draws no area', () => {
    const chart = buildTrendChart([point('Jan', '12.00')]);

    expect(chart.points).toHaveLength(1);
    expect(chart.points[0].x).toBeCloseTo((chart.left + chart.right) / 2);
    expect(chart.labels[0].anchor).toBe('middle');
    expect(chart.area).toBe('');
  });

  it('limits x-axis labels and keeps every point within the plot', () => {
    const points = Array.from({ length: 12 }, (_, index) =>
      point(`2024-${String(index + 1).padStart(2, '0')}`, String(index * 5)),
    );

    const chart = buildTrendChart(points);

    expect(chart.labels.length).toBeLessThanOrEqual(4);
    expect(chart.labels[0].anchor).toBe('start');
    expect(chart.labels[chart.labels.length - 1].anchor).toBe('end');
    for (const chartPoint of chart.points) {
      expect(chartPoint.x).toBeGreaterThanOrEqual(chart.left);
      expect(chartPoint.x).toBeLessThanOrEqual(chart.right);
      expect(chartPoint.y).toBeGreaterThanOrEqual(chart.top);
      expect(chartPoint.y).toBeLessThanOrEqual(chart.bottom);
    }
  });
});
