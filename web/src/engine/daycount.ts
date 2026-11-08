import { DayCount } from "./conventions";
import { diffDays } from "./dates";

export function yearFraction(d1: Date, d2: Date, dc: DayCount = "ACT/365"): number {
  if (d2 <= d1) return 0.0;
  if (dc === "ACT/360") return diffDays(d1, d2) / 360.0;
  if (dc === "ACT/365") return diffDays(d1, d2) / 365.0;
  // 30/360 US (bond basis)
  let d1d = Math.min(d1.getUTCDate(), 30);
  let d2d = d2.getUTCDate();
  if (d1d === 30 && d2d === 31) d2d = 30;
  return (
    360 * (d2.getUTCFullYear() - d1.getUTCFullYear()) +
    30 * (d2.getUTCMonth() - d1.getUTCMonth()) +
    (d2d - d1d)
  ) / 360.0;
}
