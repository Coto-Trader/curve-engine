import { BaseCurve, Calendar, toISO } from "../engine";

export const STD_TENORS = ["1M", "3M", "6M", "12M", "18M", "2Y", "3Y", "5Y", "7Y", "10Y", "15Y", "20Y"];

export function fmt(n: number, dp = 2): string {
  if (!isFinite(n)) return "–";
  return n.toLocaleString("es-CL", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtPct(n: number, dp = 4): string {
  if (!isFinite(n)) return "–";
  return n.toFixed(dp) + " %";
}

export function fmtDf(n: number): string {
  if (!isFinite(n)) return "–";
  return n.toFixed(8);
}

export function fmtCcy(n: number): string {
  if (!isFinite(n)) return "–";
  return n.toLocaleString("es-CL", { maximumFractionDigits: 0 });
}

export interface CurveSample {
  tenor: string;
  dateISO: string;
  df: number;
  zero: number;
}

export function sampleCurve(curve: BaseCurve, valDate: Date, tenors = STD_TENORS): CurveSample[] {
  const cal = new Calendar(["USNY", "CLSA"]);
  const spot = cal.spotDate(valDate, 2);
  return tenors.map((t) => {
    const d = cal.addTenor(spot, t);
    return { tenor: t, dateISO: toISO(d), df: safe(() => curve.getDf(d)), zero: safe(() => curve.getZeroRate(d)) };
  });
}

function safe(fn: () => number): number {
  try { return fn(); } catch { return NaN; }
}
