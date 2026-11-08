import { BusinessDayConvention as BDC } from "./conventions";
import { addDays, addMonths, parseISO, toISO, weekday } from "./dates";

// Tablas de feriados semilla (identicas al motor Python). Editables en caliente.
const CLSA = [
  "2026-01-01","2026-04-03","2026-05-01","2026-05-21","2026-06-20","2026-06-29",
  "2026-07-16","2026-08-15","2026-09-18","2026-09-19","2026-10-12","2026-10-31",
  "2026-11-01","2026-12-08","2026-12-25",
  "2027-01-01","2027-03-26","2027-05-01","2027-05-21","2027-06-21","2027-06-29",
  "2027-07-16","2027-08-15","2027-09-18","2027-09-19","2027-10-12","2027-10-31",
  "2027-11-01","2027-12-08","2027-12-25",
  "2028-01-01","2028-05-01","2028-05-21","2028-07-16","2028-08-15","2028-09-18",
  "2028-09-19","2028-10-12","2028-11-01","2028-12-08","2028-12-25",
];
const USNY = [
  "2026-01-01","2026-01-19","2026-02-16","2026-05-25","2026-06-19","2026-07-03",
  "2026-09-07","2026-10-12","2026-11-11","2026-11-26","2026-12-25",
  "2027-01-01","2027-01-18","2027-02-15","2027-05-31","2027-06-18","2027-07-05",
  "2027-09-06","2027-10-11","2027-11-11","2027-11-25","2027-12-24",
  "2028-01-17","2028-02-21","2028-05-29","2028-06-19","2028-07-04","2028-09-04",
  "2028-10-09","2028-11-23","2028-12-25",
];

const HOLIDAY_TABLES: Record<string, Set<string>> = {
  CLSA: new Set(CLSA),
  USNY: new Set(USNY),
  TARGET: new Set<string>(),
};

export function registerHolidays(center: string, isoDays: string[]): void {
  const key = center.toUpperCase();
  if (!HOLIDAY_TABLES[key]) HOLIDAY_TABLES[key] = new Set();
  isoDays.forEach((d) => HOLIDAY_TABLES[key].add(d));
}

const TENOR_RE = /^(\d+)\s*([DWMY])$/i;

export class Calendar {
  centers: string[];
  private holidays: Set<string>;

  constructor(centers: string[]) {
    this.centers = centers.map((c) => c.toUpperCase());
    this.holidays = new Set();
    for (const c of this.centers) {
      const t = HOLIDAY_TABLES[c];
      if (t) t.forEach((d) => this.holidays.add(d));
    }
  }

  isHoliday(d: Date): boolean {
    return this.holidays.has(toISO(d));
  }

  isBusinessDay(d: Date): boolean {
    return weekday(d) < 5 && !this.holidays.has(toISO(d));
  }

  private roll(d: Date, step: number): Date {
    let cur = d;
    while (!this.isBusinessDay(cur)) cur = addDays(cur, step);
    return cur;
  }

  adjust(d: Date, conv: BDC = "MODIFIED_FOLLOWING"): Date {
    if (conv === "UNADJUSTED" || this.isBusinessDay(d)) return d;
    if (conv === "FOLLOWING" || conv === "MODIFIED_FOLLOWING") {
      const nd = this.roll(d, 1);
      if (conv === "MODIFIED_FOLLOWING" && nd.getUTCMonth() !== d.getUTCMonth()) {
        return this.roll(d, -1);
      }
      return nd;
    }
    const nd = this.roll(d, -1);
    if (conv === "MODIFIED_PRECEDING" && nd.getUTCMonth() !== d.getUTCMonth()) {
      return this.roll(d, 1);
    }
    return nd;
  }

  advanceBusinessDays(d: Date, n: number): Date {
    let cur = d;
    const step = n >= 0 ? 1 : -1;
    let rem = Math.abs(n);
    while (rem > 0) {
      cur = addDays(cur, step);
      if (this.isBusinessDay(cur)) rem -= 1;
    }
    return cur;
  }

  addTenor(start: Date, tenor: string, conv: BDC = "MODIFIED_FOLLOWING"): Date {
    const m = TENOR_RE.exec(tenor.trim());
    if (!m) throw new Error(`Tenor invalido: ${tenor}`);
    const n = parseInt(m[1], 10);
    const unit = m[2].toUpperCase();
    if (unit === "D") return this.advanceBusinessDays(start, n);
    if (unit === "W") return this.adjust(addDays(start, 7 * n), conv);
    if (unit === "M") return this.adjust(addMonths(start, n), conv);
    if (unit === "Y") return this.adjust(addMonths(start, 12 * n), conv);
    throw new Error(`Unidad de tenor no soportada: ${unit}`);
  }

  spotDate(tradeDate: Date, lagDays: number): Date {
    return this.advanceBusinessDays(tradeDate, lagDays);
  }
}

export { parseISO, toISO, addMonths };
