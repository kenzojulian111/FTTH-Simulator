export function formatReportDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

export function formatReportNumber(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

export function formatReportCurrency(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try {
    // Backend calculations can return fractional amounts even for zero-decimal
    // currencies. Keep those returned fractions visible while using the same
    // locale and currency symbol throughout the report.
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 3 }).format(value);
  } catch {
    return `${currency} ${formatReportNumber(value, 2)}`;
  }
}

export function detailNumber(details: Record<string, unknown> | null | undefined, field: string): number | null {
  const value = details?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function detailString(details: Record<string, unknown> | null | undefined, field: string): string | null {
  const value = details?.[field];
  return typeof value === "string" ? value : null;
}
