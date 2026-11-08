// Utilidades de fecha en UTC (medianoche) para evitar problemas de zona horaria.

const MS_DAY = 86_400_000;

export function ymd(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return ymd(y, m, d);
}

export function toISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function diffDays(d1: Date, d2: Date): number {
  return Math.round((d2.getTime() - d1.getTime()) / MS_DAY);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_DAY);
}

export function weekday(d: Date): number {
  // 0 = lunes ... 6 = domingo (coincide con Python date.weekday())
  return (d.getUTCDay() + 6) % 7;
}

export function addMonths(d: Date, months: number): Date {
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const y = Math.floor(total / 12);
  const m = total % 12; // 0-based
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}

export const dayKey = toISO;
