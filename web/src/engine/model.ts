// Modelo serializable que edita el mantenedor + armado del sistema de curvas.
// Es el equivalente en navegador de config.py del motor Python.
import { Calendar } from "./calendars";
import { BaseCurve, InflationDiscountCurve, InflationForwardCurve, InheritedCurve, NativeCurve } from "./curves";
import { DayCount, Frequency, InterpolationMode, QuoteType } from "./conventions";
import { MarketFeedManager } from "./feed";
import { makeNode, MarketNode } from "./nodes";
import { LegCurveRouter, RoutingRule } from "./router";
import { SwapManager } from "./pricing";
import { parseISO } from "./dates";

export interface InputCfg {
  ticker: string;
  mid: number | null;
  bid?: number | null;
  ask?: number | null;
  provider?: string;
  description?: string;
}

export interface CurrencyCfg {
  code: string;            // "CLP", "USD", "EUR", "CLF"
  name: string;
  calendars: string[];
  indices: string[];       // indices flotantes validos: ["CLICP"], ["SOFR"], ...
  spotLag: number;
}

export interface NodeCfg {
  tenor: string;
  ticker: string;
  type: QuoteType;
  freq: Frequency;
  dayCount?: DayCount;
  pointsScale?: number;
  spreadBps?: number;
  enabled?: boolean;
}

export interface CurveCfg {
  id: string;
  name: string;
  currency: string;
  kind: "NATIVE" | "BRIDGE" | "INHERITED" | "INFLATION_FWD" | "INFLATION_DISC";
  // comunes a NATIVE/BRIDGE
  calendars?: string[];
  spotLag?: number;
  dayCount?: DayCount;
  interpolation?: InterpolationMode;
  nodes?: NodeCfg[];
  // INHERITED
  parentCollateral?: string;
  parentLocal?: string;
  bridge?: string;
  spotFxKey?: string;
  cutoff?: string;
  nominal?: string;   // INFLATION_FWD: curva nominal CLP para despejar el tramo real
}

export interface ProductLegCfg {
  ccy: string;
  index: string;           // "FIXED" | "CLICP" | "SOFR" | ...
  freq: Frequency;
  dayCount: DayCount;
  calendars: string[];
}

export interface ProductCfg {
  id: string;
  name: string;
  kind: "IRS" | "CCS";
  legA: ProductLegCfg;
  legB: ProductLegCfg;
  allowedCollaterals: string[];  // ["USD","CLP","NONE"]
}

export interface AppConfig {
  valuationDate: string;
  reportingCcy: string;
  spotFx: Record<string, number>;
  inputs: InputCfg[];
  currencies: CurrencyCfg[];
  curves: CurveCfg[];
  routing: RoutingRule[];
  products: ProductCfg[];
}

export interface CurveSystem {
  valDate: Date;
  feed: MarketFeedManager;
  registry: Record<string, BaseCurve>;
  router: LegCurveRouter;
  swapManager: SwapManager;
  errors: string[];
}

function nodeFromCfg(n: NodeCfg, curve: CurveCfg): MarketNode {
  return makeNode({
    tenor: n.tenor,
    ticker: n.ticker,
    quoteType: n.type,
    freq: n.freq,
    dayCount: n.dayCount ?? curve.dayCount ?? "ACT/360",
    calendars: curve.calendars ?? ["CLSA"],
    spotLagDays: curve.spotLag ?? 2,
    pointsScale: n.pointsScale ?? 1,
    nodeSpreadBps: n.spreadBps ?? 0,
    enabled: n.enabled ?? true,
  });
}

export function buildSystem(cfg: AppConfig): CurveSystem {
  const errors: string[] = [];
  const valDate = parseISO(cfg.valuationDate);

  const feed = new MarketFeedManager();
  for (const inp of cfg.inputs) {
    if (inp.bid != null || inp.ask != null) {
      feed.ingest(inp.ticker, {
        provider: inp.provider ?? "SEED",
        bid: inp.bid ?? inp.mid ?? null,
        ask: inp.ask ?? inp.mid ?? null,
        isHealthy: true,
      });
    } else if (inp.mid != null) {
      feed.ingestSimple(inp.ticker, inp.mid, inp.provider ?? "SEED");
    }
  }

  const registry: Record<string, BaseCurve> = {};
  const bridges: Record<string, MarketNode[]> = {};

  // 1a. nativas + contenedores puente
  for (const c of cfg.curves) {
    if (c.kind === "NATIVE") {
      const curve = new NativeCurve(c.id, c.name, c.currency, valDate, (c.nodes ?? []).map((n) => nodeFromCfg(n, c)));
      if (c.interpolation) curve.interpolation = c.interpolation;
      registry[c.id] = curve;
    } else if (c.kind === "BRIDGE") {
      bridges[c.id] = (c.nodes ?? []).map((n) => nodeFromCfg(n, c));
    }
  }

  // 1b. inflacion forward (520) — necesita la curva nominal CLP ya registrada
  for (const c of cfg.curves) {
    if (c.kind !== "INFLATION_FWD") continue;
    const ufSpot = cfg.spotFx[c.spotFxKey ?? ""] ?? 0;
    const nominal = c.nominal ? registry[c.nominal] ?? null : null;
    registry[c.id] = new InflationForwardCurve(
      c.id, c.name, c.currency, valDate,
      (c.nodes ?? []).map((n) => nodeFromCfg(n, c)), ufSpot, c.calendars ?? ["CLSA"], nominal
    );
  }

  // 2. heredadas + descuento de inflacion (orden de dependencia; recursivo)
  const inherited = cfg.curves.filter((c) => c.kind === "INHERITED" || c.kind === "INFLATION_DISC");
  let pending = [...inherited];
  let guard = 0;
  while (pending.length && guard < 100) {
    guard += 1;
    const next: CurveCfg[] = [];
    for (const c of pending) {
      const colOk = c.parentCollateral && registry[c.parentCollateral];
      const locOk = c.parentLocal && registry[c.parentLocal];
      if (!colOk || !locOk) { next.push(c); continue; }
      if (c.kind === "INFLATION_DISC") {
        registry[c.id] = new InflationDiscountCurve(
          c.id, c.name, c.currency, valDate,
          registry[c.parentCollateral!], registry[c.parentLocal!] as InflationForwardCurve
        );
        continue;
      }
      const bridgeCfg = cfg.curves.find((x) => x.id === c.bridge);
      const bridgeNodes = c.bridge ? bridges[c.bridge] ?? [] : [];
      const cal = new Calendar(bridgeCfg?.calendars ?? ["CLSA"]);
      const spot = cal.spotDate(valDate, bridgeCfg?.spotLag ?? 2);
      const cutoff = cal.addTenor(spot, c.cutoff ?? "18M");
      const spotVal = cfg.spotFx[c.spotFxKey ?? ""] ?? 0;
      registry[c.id] = new InheritedCurve(
        c.id, c.name, c.currency, valDate,
        registry[c.parentCollateral!], registry[c.parentLocal!],
        bridgeNodes, spotVal, cutoff
      );
    }
    if (next.length === pending.length) {
      errors.push(`Curvas heredadas sin resolver (padre faltante o ciclo): ${next.map((x) => x.id).join(", ")}`);
      break;
    }
    pending = next;
  }

  // 3. construccion ex-ante
  for (const id of Object.keys(registry)) {
    try {
      if (!registry[id].isBuilt) registry[id].build(feed);
    } catch (e) {
      errors.push(`Error construyendo ${id}: ${(e as Error).message}`);
    }
  }

  // 4. ruteo
  const router = new LegCurveRouter(registry);
  for (const r of cfg.routing) router.registerRule(r);

  const swapManager = new SwapManager(router, cfg.spotFx, cfg.reportingCcy);
  return { valDate, feed, registry, router, swapManager, errors };
}
