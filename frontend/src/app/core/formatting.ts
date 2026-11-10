export function formatMoney(value: string | null, currency = 'GBP'): string {
  if (value === null) {
    return '—';
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return value;
  }
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

export function formatPercent(value: string | null, digits = 2): string {
  if (value === null) {
    return '—';
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return value;
  }
  return `${amount.toFixed(digits)}%`;
}

export function formatDate(value: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
