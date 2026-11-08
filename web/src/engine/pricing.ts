import { addMonths, Calendar } from "./calendars";
import { BusinessDayConvention, DayCount, Frequency, FREQ_MONTHS } from "./conventions";
import { yearFraction } from "./daycount";
import { LegCurveRouter } from "./router";

export interface CouponPeriod {
  accrualStart: Date;
  accrualEnd: Date;
  payDate: Date;
}

export function generateSchedule(
  effective: Date,
  maturity: Date,
  freq: Frequency,
  calendars: string[],
  conv: BusinessDayConvention = "MODIFIED_FOLLOWING",
  payDelayDays = 0
): CouponPeriod[] {
  const cal = new Calendar(calendars);
  const months = FREQ_MONTHS[freq];
  if (months <= 0) {
    const end = cal.adjust(maturity, conv);
    return [{ accrualStart: effective, accrualEnd: end, payDate: cal.advanceBusinessDays(end, payDelayDays) }];
  }
  const rawDates: Date[] = [];
  let k = 1;
  while (true) {
    const raw = addMonths(maturity, -months * k);
    if (raw <= effective) break;
    rawDates.push(raw);
    k += 1;
  }
  rawDates.sort((a, b) => a.getTime() - b.getTime());
  const boundaries = [effective, ...rawDates.map((d) => cal.adjust(d, conv)), cal.adjust(maturity, conv)];
  const periods: CouponPeriod[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    const aEnd = boundaries[i];
    periods.push({
      accrualStart: boundaries[i - 1],
      accrualEnd: aEnd,
      payDate: cal.advanceBusinessDays(aEnd, payDelayDays),
    });
  }
  return periods;
}

export interface SwapLeg {
  currency: string;
  legIndex: string;        // "FIXED", "CLICP", "SOFR", ...
  notional: number;
  payFreq: Frequency;
  dayCount: DayCount;
  calendars: string[];
  fixedRatePct?: number;
  spreadBps?: number;
  payDelayDays?: number;
}

export interface SwapTicket {
  valDate: Date;
  effectiveDate: Date;
  maturityDate: Date;
  legA: SwapLeg;           // pata recibida (si receiveA)
  legB: SwapLeg;           // pata pagada
  csaCurrency: string;
  receiveA: boolean;
  conv?: BusinessDayConvention;
}

export interface LegValuation {
  pv: number;              // en moneda de la pata
  annuity: number;         // Sum alpha_i * DF  (x nocional)
  periods: number;
  currency: string;
  isFixed: boolean;
}

export interface SwapResult {
  npv: number;             // en moneda de reporte
  reportingCcy: string;
  legA: LegValuation;
  legB: LegValuation;
  parRatePct: number | null;
  dv01: number;            // en moneda de reporte, por bp sobre la pata fija
}

export class SwapManager {
  router: LegCurveRouter;
  spotFx: Record<string, number>;
  reportingCcy: string;

  constructor(router: LegCurveRouter, spotFx: Record<string, number> = {}, reportingCcy = "CLP") {
    this.router = router;
    this.spotFx = spotFx;
    this.reportingCcy = reportingCcy;
  }

  /** Multiplicador para convertir 1 unidad de `ccy` a la moneda de reporte. */
  fxTo(ccy: string): number {
    const c = ccy.toUpperCase();
    const rep = this.reportingCcy.toUpperCase();
    if (c === rep) return 1;
    const direct = this.spotFx[`${c}${rep}`];
    if (direct) return direct;
    const inverse = this.spotFx[`${rep}${c}`];
    if (inverse) return 1 / inverse;
    // triangulacion via USD (EUR->USD->CLP, etc.)
    const toUsd = c === "USD" ? 1 : this.spotFx[`${c}USD`] ?? (this.spotFx[`USD${c}`] ? 1 / this.spotFx[`USD${c}`] : null);
    const usdToRep = rep === "USD" ? 1 : this.spotFx[`USD${rep}`] ?? (this.spotFx[`${rep}USD`] ? 1 / this.spotFx[`${rep}USD`] : null);
    if (toUsd != null && usdToRep != null) return toUsd * usdToRep;
    throw new Error(`Sin spot FX para convertir ${c} -> ${rep}`);
  }

  private valueLeg(leg: SwapLeg, ticket: SwapTicket, exchangeNotional = false): LegValuation {
    const conv = ticket.conv ?? "MODIFIED_FOLLOWING";
    const isFixed = leg.legIndex.toUpperCase() === "FIXED";
    const assign = this.router.resolve(leg.currency, isFixed ? "FIXED" : leg.legIndex, ticket.csaCurrency);
    const disc = assign.discountCurve;
    const periods = generateSchedule(
      ticket.effectiveDate, ticket.maturityDate, leg.payFreq, leg.calendars, conv, leg.payDelayDays ?? 0
    );
    let annuity = 0;
    let pv = 0;
    if (isFixed) {
      for (const p of periods) annuity += yearFraction(p.accrualStart, p.accrualEnd, leg.dayCount) * disc.getDf(p.payDate);
      pv = leg.notional * ((leg.fixedRatePct ?? 0) / 100.0) * annuity;
    } else {
      const proj = assign.forecastCurve;
      if (!proj) throw new Error(`Pata flotante ${leg.legIndex} sin curva de proyeccion.`);
      const spread = (leg.spreadBps ?? 0) / 10000.0;
      for (const p of periods) {
        const dfPay = disc.getDf(p.payDate);
        const growth = proj.getDf(p.accrualStart) / proj.getDf(p.accrualEnd) - 1.0;
        const alpha = yearFraction(p.accrualStart, p.accrualEnd, leg.dayCount);
        pv += leg.notional * (growth + spread * alpha) * dfPay;
        annuity += alpha * dfPay;
      }
    }
    // Intercambio de principal (solo CCS): desde la óptica del receptor de la
    // pata, -N en el inicio (efectivo) y +N al vencimiento, descontados con la
    // curva colateralizada. Hace que un CCS de basis de mercado valorice a ~0.
    if (exchangeNotional && periods.length > 0) {
      const initDf = disc.getDf(ticket.effectiveDate);
      const finalDf = disc.getDf(periods[periods.length - 1].payDate);
      pv += leg.notional * (finalDf - initDf);
    }
    return { pv, annuity: leg.notional * annuity, periods: periods.length, currency: leg.currency, isFixed };
  }

  price(ticket: SwapTicket): SwapResult {
    const isCcs = ticket.legA.currency.toUpperCase() !== ticket.legB.currency.toUpperCase();
    const a = this.valueLeg(ticket.legA, ticket, isCcs);
    const b = this.valueLeg(ticket.legB, ticket, isCcs);
    const aRep = a.pv * this.fxTo(a.currency);
    const bRep = b.pv * this.fxTo(b.currency);
    const npv = ticket.receiveA ? aRep - bRep : bRep - aRep;

    // Tasa par y DV01: solo si hay exactamente una pata fija (IRS / CCS fix-float).
    let parRatePct: number | null = null;
    let dv01 = 0;
    const fixed = a.isFixed ? a : b.isFixed ? b : null;
    const floatLeg = a.isFixed ? b : b.isFixed ? a : null;
    if (fixed && floatLeg && !(a.isFixed && b.isFixed)) {
      // par en la moneda de la pata fija: PV flotante / annuity fija, mismo signo de moneda
      const fixedFx = this.fxTo(fixed.currency);
      const floatRepPv = (fixed === a ? b.pv : a.pv) * this.fxTo(floatLeg.currency);
      const annuityRep = fixed.annuity * fixedFx;
      parRatePct = annuityRep !== 0 ? (floatRepPv / annuityRep) * 100.0 : null;
      dv01 = annuityRep * 1e-4;
    }
    return { npv, reportingCcy: this.reportingCcy, legA: a, legB: b, parRatePct, dv01 };
  }
}
