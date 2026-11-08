import { addMonths, Calendar } from "./calendars";
import {
  DayCount,
  FREQ_MONTHS,
  InterpolationMode,
  SpreadStage,
} from "./conventions";
import { diffDays, toISO, ymd } from "./dates";
import { yearFraction } from "./daycount";
import { MarketFeedManager } from "./feed";
import {
  MarketNode,
  nodeCalendar,
  nodeEffectiveQuote,
  nodeMaturity,
  nodeSpot,
} from "./nodes";

export abstract class BaseCurve {
  curveId: string;
  name: string;
  currency: string;
  valDate: Date;
  parallelShiftBps = 0;
  spreadStage: SpreadStage = "PRE_BOOTSTRAP";
  interpolation: InterpolationMode = "LOG_LINEAR_DF";
  protected pillars = new Map<string, number>();
  protected sorted: Date[] = [];
  isBuilt = false;

  constructor(curveId: string, name: string, currency: string, valDate: Date) {
    this.curveId = curveId;
    this.name = name;
    this.currency = currency;
    this.valDate = valDate;
    this.resetPillars();
  }

  protected resetPillars(): void {
    this.pillars = new Map([[toISO(this.valDate), 1.0]]);
    this.sorted = [this.valDate];
  }

  protected setPillar(d: Date, df: number): void {
    this.pillars.set(toISO(d), Math.max(df, 1e-12));
    this.sorted = [...this.pillars.keys()].map((s) => new Date(s + "T00:00:00Z")).sort((a, b) => a.getTime() - b.getTime());
  }

  protected finalize(): void {
    this.isBuilt = true;
  }

  abstract build(feed: MarketFeedManager): void;

  getDf(target: Date): number {
    if (!this.isBuilt) throw new Error(`Curva ${this.curveId} no construida (build ex-ante pendiente).`);
    let base = this.rawDf(target);
    if (this.spreadStage === "POST_BOOTSTRAP" && this.parallelShiftBps !== 0) {
      const tau = yearFraction(this.valDate, target, "ACT/365");
      base *= Math.exp(-(this.parallelShiftBps / 10000.0) * tau);
    }
    return base;
  }

  protected rawDf(target: Date): number {
    if (target <= this.valDate) return 1.0;
    const key = toISO(target);
    if (this.pillars.has(key)) return this.pillars.get(key)!;
    const sd = this.sorted;
    const last = sd[sd.length - 1];
    if (target > last) {
      const tLast = yearFraction(this.valDate, last, "ACT/365");
      const zLast = -Math.log(this.pillars.get(toISO(last))!) / tLast;
      const tTgt = yearFraction(this.valDate, target, "ACT/365");
      return Math.exp(-zLast * tTgt);
    }
    // log-lineal en DF entre vecinos
    let lo = sd[0];
    let hi = sd[sd.length - 1];
    for (const d of sd) {
      if (d > target) { hi = d; break; }
      lo = d;
    }
    const ln0 = Math.log(this.pillars.get(toISO(lo))!);
    const ln1 = Math.log(this.pillars.get(toISO(hi))!);
    const w = diffDays(lo, target) / Math.max(diffDays(lo, hi), 1);
    return Math.exp(ln0 + w * (ln1 - ln0));
  }

  getZeroRate(target: Date, dc: DayCount = "ACT/365"): number {
    if (target <= this.valDate) return 0.0;
    const tau = yearFraction(this.valDate, target, dc);
    return (-Math.log(this.getDf(target)) / tau) * 100.0;
  }

  getForwardRate(d1: Date, d2: Date, dc: DayCount = "ACT/360"): number {
    const tau = yearFraction(d1, d2, dc);
    if (tau <= 0) return 0.0;
    return ((this.getDf(d1) / this.getDf(d2)) - 1.0) / tau * 100.0;
  }

  pillarList(): { date: Date; df: number }[] {
    return this.sorted.map((d) => ({ date: d, df: this.pillars.get(toISO(d))! }));
  }
}

// --------------------------------------------------------------------------
export class NativeCurve extends BaseCurve {
  nodes: MarketNode[];

  constructor(curveId: string, name: string, currency: string, valDate: Date, nodes: MarketNode[]) {
    super(curveId, name, currency, valDate);
    this.nodes = [...nodes].sort(
      (a, b) => nodeMaturity(a, valDate).getTime() - nodeMaturity(b, valDate).getTime()
    );
  }

  build(feed: MarketFeedManager): void {
    this.resetPillars();
    for (const node of this.nodes) {
      if (node.enabled === false) continue;
      let [quote] = nodeEffectiveQuote(node, feed);
      if (quote == null) continue; // nodo con error -> se salta limpio
      if (this.spreadStage === "PRE_BOOTSTRAP") quote += this.parallelShiftBps / 100.0;
      const df = this.dfForNode(node, quote / 100.0);
      this.setPillar(nodeMaturity(node, this.valDate), df);
    }
    this.finalize();
  }

  private dfForNode(node: MarketNode, r: number): number {
    const maturity = nodeMaturity(node, this.valDate);
    const spot = nodeSpot(node, this.valDate);
    const schedule = this.couponSchedule(node, spot, maturity);
    if (node.freq === "Z" || node.quoteType === "CASH" || schedule.length <= 1) {
      const tau = yearFraction(this.valDate, maturity, node.dayCount);
      return 1.0 / (1.0 + r * tau);
    }
    let annuityPrev = 0.0;
    let prev = spot;
    for (let i = 0; i < schedule.length - 1; i++) {
      const cpn = schedule[i];
      const alpha = yearFraction(prev, cpn, node.dayCount);
      annuityPrev += alpha * this.rawDf(cpn);
      prev = cpn;
    }
    const alphaN = yearFraction(prev, maturity, node.dayCount);
    return (1.0 - r * annuityPrev) / (1.0 + r * alphaN);
  }

  private couponSchedule(node: MarketNode, spot: Date, maturity: Date): Date[] {
    const FREQ_MONTHS: Record<string, number> = { Z: 0, M: 1, Q: 3, "S/A": 6, A: 12 };
    const months = FREQ_MONTHS[node.freq] ?? 0;
    if (months <= 0) return [maturity];
    const cal = nodeCalendar(node);
    const dates: Date[] = [];
    let k = 1;
    while (true) {
      const raw = addMonths(maturity, -months * k);
      if (raw <= spot) break;
      dates.push(cal.adjust(raw, node.rollConvention ?? "MODIFIED_FOLLOWING"));
      k += 1;
    }
    const uniq = [...new Map(dates.map((d) => [toISO(d), d])).values()].sort(
      (a, b) => a.getTime() - b.getTime()
    );
    uniq.push(maturity);
    return uniq;
  }
}

// --------------------------------------------------------------------------
export class InheritedCurve extends BaseCurve {
  parentCol: BaseCurve;
  parentLoc: BaseCurve;
  bridgeNodes: MarketNode[];
  spotFx: number;
  cutoffDate: Date;

  constructor(
    curveId: string,
    name: string,
    currency: string,
    valDate: Date,
    parentCol: BaseCurve,
    parentLoc: BaseCurve,
    bridgeNodes: MarketNode[],
    spotFx: number,
    cutoffDate: Date
  ) {
    super(curveId, name, currency, valDate);
    this.parentCol = parentCol;
    this.parentLoc = parentLoc;
    this.bridgeNodes = [...bridgeNodes].sort(
      (a, b) => nodeMaturity(a, valDate).getTime() - nodeMaturity(b, valDate).getTime()
    );
    this.spotFx = spotFx;
    this.cutoffDate = cutoffDate;
  }

  build(feed: MarketFeedManager): void {
    if (!this.parentCol.isBuilt) this.parentCol.build(feed);
    if (!this.parentLoc.isBuilt) this.parentLoc.build(feed);
    this.resetPillars();
    for (const node of this.bridgeNodes) {
      if (node.enabled === false) continue;
      const [val] = nodeEffectiveQuote(node, feed);
      if (val == null) continue;
      const mat = nodeMaturity(node, this.valDate);
      let df: number;
      if (node.quoteType === "FX_FWD_PTS" && mat <= this.cutoffDate) {
        const dfBase = this.parentCol.getDf(mat);
        const fwd = this.spotFx + val * (node.pointsScale ?? 1);
        df = dfBase * (this.spotFx / fwd);
      } else if (node.quoteType === "CCS_BASIS" && mat >= this.cutoffDate) {
        // Solver CCS par: despeja DF_d(T_N) para que el cross-currency basis
        // swap de mercado valga 0 (ver solveBasisParNode).
        df = this.solveBasisParNode(node, mat, val / 10000.0);
      } else {
        continue; // nodo fuera de su tramo segun cutoff
      }
      this.setPillar(mat, df);
    }
    this.finalize();
  }

  /**
   * Despeje par del cross-currency basis swap (reemplaza la aproximacion
   * DF_loc*exp(-b*t)). Usa el resultado estandar de que la pata base (USD SOFR
   * flat, proyectada y descontada con la misma curva OIS, con intercambio de
   * principal) vale par (=0) bajo colateral USD. Entonces el swap vale 0 sii la
   * pata local (indice local + basis b, con intercambio de principal) tambien
   * vale 0, descontada con la curva desconocida DF_d:
   *
   *   sum_i ( fwd_loc_i + b * alpha_i ) * DF_d(t_i) + DF_d(T_N) - 1 = 0
   *
   * donde fwd_loc_i = DF_loc(t_{i-1})/DF_loc(t_i) - 1 (indice local compuesto,
   * exacto por ratio de DF de la curva de proyeccion). Se resuelve DF_d(T_N)
   * por biseccion; los nodos intermedios ya construidos se interpolan y los que
   * caen entre el ultimo pilar y T_N se interpolan log-lineal contra el valor
   * de prueba. b en decimal (bps/1e4).
   */
  private solveBasisParNode(node: MarketNode, mat: Date, b: number): number {
    const freqMonths = FREQ_MONTHS[node.freq] || 12;
    const cal = new Calendar(node.calendars);
    const dc = node.dayCount;
    const roll = node.rollConvention ?? "MODIFIED_FOLLOWING";

    // bordes de cupon: valDate, +f, +2f, ..., T_N (anual por defecto)
    const bounds: Date[] = [this.valDate];
    let k = 1;
    for (;;) {
      const d = addMonths(this.valDate, freqMonths * k);
      if (d >= mat) break;
      bounds.push(cal.adjust(d, roll));
      k += 1;
    }
    bounds.push(mat);

    const lastDate = this.sorted[this.sorted.length - 1];
    const lastDf = this.rawDf(lastDate);

    const dfTrial = (t: Date, x: number): number => {
      if (t.getTime() === mat.getTime()) return x;
      if (t <= lastDate) return this.rawDf(t);
      const w = diffDays(lastDate, t) / Math.max(diffDays(lastDate, mat), 1);
      return Math.exp(Math.log(lastDf) + w * (Math.log(x) - Math.log(lastDf)));
    };

    const g = (x: number): number => {
      let s = 0;
      for (let i = 1; i < bounds.length; i++) {
        const t0 = bounds[i - 1], t1 = bounds[i];
        const fwdLoc = this.parentLoc.getDf(t0) / this.parentLoc.getDf(t1) - 1;
        const alpha = yearFraction(t0, t1, dc);
        s += (fwdLoc + b * alpha) * dfTrial(t1, x);
      }
      return s + x - 1;
    };

    let lo = 1e-9, hi = 1.2;
    if (g(lo) > 0) return lo;
    if (g(hi) < 0) return hi;
    for (let it = 0; it < 200 && hi - lo > 1e-14; it++) {
      const mid = 0.5 * (lo + hi);
      if (g(mid) > 0) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
  }
}

// --------------------------------------------------------------------------
// Curvas de inflacion UF (CLF)
// --------------------------------------------------------------------------
function tenorToMonths(tenor: string): number {
  const m = /^(\d+)\s*([MY])$/i.exec(tenor.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return m[2].toUpperCase() === "Y" ? n * 12 : n;
}

/** Vencimiento anclado al dia 9 del mes objetivo (o habil anterior). */
export function day9Maturity(valDate: Date, tenor: string, calendars: string[]): Date {
  const cal = new Calendar(calendars);
  const base = addMonths(valDate, tenorToMonths(tenor));
  const d9 = ymd(base.getUTCFullYear(), base.getUTCMonth() + 1, 9);
  return cal.adjust(d9, "MODIFIED_PRECEDING");
}

/**
 * Curva de proyeccion de UF (520 CLF vs Camara). Guarda factores 1/g(T) donde
 * g(T) = UF_Fwd(T)/UF_spot, de modo que se comporta como un DF decreciente: la
 * pata UF proyecta su crecimiento con get_df (ratio inverso) igual que un OIS.
 * Tasa cero => inflacion implicita.
 *
 * Tramo corto (INF_FWD_UF): forwards de UF outright anclados al dia 9 del mes
 *   -> g = UF_Fwd/UF_spot directo.
 * Tramo largo (UF_REAL_SWAP): swaps Camara UF a tasa real R. Se despeja g(T_N)
 *   por el par del swap (ver solveRealSwapNode) usando la curva nominal CLP.
 */
export class InflationForwardCurve extends BaseCurve {
  nodes: MarketNode[];
  ufSpot: number;
  calendars: string[];
  nominal: BaseCurve | null;

  constructor(curveId: string, name: string, currency: string, valDate: Date, nodes: MarketNode[], ufSpot: number, calendars: string[], nominal: BaseCurve | null = null) {
    super(curveId, name, currency, valDate);
    this.nodes = nodes;
    this.ufSpot = ufSpot;
    this.calendars = calendars;
    this.nominal = nominal;
  }

  ufForward(target: Date): number {
    return this.ufSpot / this.getDf(target);
  }

  private maturityOf(node: MarketNode): Date {
    if (node.quoteType === "INF_FWD_UF") return day9Maturity(this.valDate, node.tenor, this.calendars);
    const cal = new Calendar(this.calendars);
    return cal.addTenor(cal.spotDate(this.valDate, node.spotLagDays ?? 2), node.tenor, node.rollConvention ?? "MODIFIED_FOLLOWING");
  }

  build(feed: MarketFeedManager): void {
    if (this.nominal && !this.nominal.isBuilt) this.nominal.build(feed);
    this.resetPillars();
    const sorted = [...this.nodes].sort(
      (a, b) => this.maturityOf(a).getTime() - this.maturityOf(b).getTime()
    );
    for (const node of sorted) {
      if (node.enabled === false) continue;
      const [val] = nodeEffectiveQuote(node, feed);
      if (val == null) continue;
      const mat = this.maturityOf(node);
      if (node.quoteType === "INF_FWD_UF") {
        if (val <= 0) continue;
        this.setPillar(mat, this.ufSpot / val); // 1/g = UF_spot / UF_Fwd
      } else if (node.quoteType === "UF_REAL_SWAP" && this.nominal) {
        this.setPillar(mat, this.solveRealSwapNode(node, mat, val / 100.0));
      }
    }
    this.finalize();
  }

  /**
   * Despeja 1/g(T_N) por el par del swap Camara UF (tasa real R).
   * Usando el factor de descuento real P_r(T) = g(T)*DF_nom(T), el swap Camara
   * UF es un par swap real AUTODESCONTADO sobre la curva real (igual que un OIS
   * en su propia curva):
   *     1 - P_r(T_N) = R * sum_i alpha_i * P_r(t_i)
   * con P_r(t_i) = DF_nom(t_i) / stored(t_i) y stored = 1/g (lo que guarda la
   * curva). La curva nominal (193) solo convierte P_r <-> 1/g (relacion de
   * Fisher: inflacion = nominal - real). Se resuelve stored(T_N) por biseccion
   * (f decreciente); los nodos intermedios se interpolan contra el valor prueba.
   */
  private solveRealSwapNode(node: MarketNode, mat: Date, R: number): number {
    const nom = this.nominal!;
    const cal = new Calendar(this.calendars);
    const dc = node.dayCount;
    const roll = node.rollConvention ?? "MODIFIED_FOLLOWING";
    const freqMonths = FREQ_MONTHS[node.freq] || 6;

    const bounds: Date[] = [this.valDate];
    let k = 1;
    for (;;) {
      const d = addMonths(this.valDate, freqMonths * k);
      if (d >= mat) break;
      bounds.push(cal.adjust(d, roll));
      k += 1;
    }
    bounds.push(mat);

    const dfNomT = nom.getDf(mat);
    const lastDate = this.sorted[this.sorted.length - 1];
    const lastStored = this.rawDf(lastDate);

    const storedTrial = (t: Date, x: number): number => {
      if (t.getTime() === mat.getTime()) return x;
      if (t <= lastDate) return this.rawDf(t);
      const w = diffDays(lastDate, t) / Math.max(diffDays(lastDate, mat), 1);
      return Math.exp(Math.log(lastStored) + w * (Math.log(x) - Math.log(lastStored)));
    };

    const f = (x: number): number => {
      let s = 0;
      for (let i = 1; i < bounds.length; i++) {
        const t0 = bounds[i - 1], t1 = bounds[i];
        const alpha = yearFraction(t0, t1, dc);
        const pr = nom.getDf(t1) / storedTrial(t1, x); // P_r(t_i)
        s += alpha * pr;
      }
      const prN = dfNomT / x;                          // P_r(T_N)
      return R * s - (1 - prN);
    };

    let lo = 1e-6, hi = 1.2;
    if (f(lo) < 0) return lo;
    if (f(hi) > 0) return hi;
    for (let it = 0; it < 200 && hi - lo > 1e-14; it++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid) > 0) lo = mid; else hi = mid; // f decreciente
    }
    return 0.5 * (lo + hi);
  }
}

/**
 * Curva de descuento de flujos en UF colateralizados (440 CLF Col USD):
 *   DF_440(T) = DF_423(T) * g_520(T) = DF_parentCol(T) / DF_infl(T)
 * Combina el descuento CLP colateralizado con el factor de inflacion implicito.
 */
export class InflationDiscountCurve extends BaseCurve {
  parentCol: BaseCurve;
  infl: InflationForwardCurve;

  constructor(curveId: string, name: string, currency: string, valDate: Date, parentCol: BaseCurve, infl: InflationForwardCurve) {
    super(curveId, name, currency, valDate);
    this.parentCol = parentCol;
    this.infl = infl;
  }

  build(feed: MarketFeedManager): void {
    if (!this.parentCol.isBuilt) this.parentCol.build(feed);
    if (!this.infl.isBuilt) this.infl.build(feed);
    this.finalize();
  }

  getDf(target: Date): number {
    if (!this.isBuilt) throw new Error(`Curva ${this.curveId} no construida.`);
    if (target <= this.valDate) return 1.0;
    return this.parentCol.getDf(target) / this.infl.getDf(target);
  }
}
