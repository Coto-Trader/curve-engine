import { Calendar } from "./calendars";
import {
  BusinessDayConvention,
  DayCount,
  Frequency,
  QuoteSide,
  QuoteType,
  RATE_TYPES,
} from "./conventions";
import { MarketFeedManager } from "./feed";

/** Nodo de mercado con sus reglas microestructurales (Capa 2). */
export interface MarketNode {
  tenor: string;
  ticker: string;
  quoteType: QuoteType;
  dayCount: DayCount;
  freq: Frequency;
  calendars: string[];
  spotLagDays: number;
  fixingLagDays?: number;
  payDelayDays?: number;
  rollConvention?: BusinessDayConvention;
  providerPriority?: string[];
  nodeSpreadBps?: number;
  pointsScale?: number;
  enabled?: boolean;
  maturityISO?: string | null;
}

export function makeNode(p: Partial<MarketNode> & Pick<MarketNode, "tenor" | "ticker" | "quoteType">): MarketNode {
  return {
    dayCount: "ACT/360",
    freq: "Z",
    calendars: ["CLSA"],
    spotLagDays: 2,
    fixingLagDays: 0,
    payDelayDays: 0,
    rollConvention: "MODIFIED_FOLLOWING",
    providerPriority: ["BGN", "CMPN", "MANUAL"],
    nodeSpreadBps: 0,
    pointsScale: 1,
    enabled: true,
    maturityISO: null,
    ...p,
  };
}

export function nodeCalendar(n: MarketNode): Calendar {
  return new Calendar(n.calendars);
}

export function nodeSpot(n: MarketNode, valDate: Date): Date {
  return nodeCalendar(n).spotDate(valDate, n.spotLagDays);
}

export function nodeMaturity(n: MarketNode, valDate: Date): Date {
  if (n.maturityISO) return new Date(n.maturityISO + "T00:00:00Z");
  const cal = nodeCalendar(n);
  const spot = cal.spotDate(valDate, n.spotLagDays);
  return cal.addTenor(spot, n.tenor, n.rollConvention ?? "MODIFIED_FOLLOWING");
}

export function nodeEffectiveQuote(
  n: MarketNode,
  feed: MarketFeedManager,
  side: QuoteSide = "MID"
): [number | null, string] {
  const [raw, source] = feed.resolve(n.ticker, n.providerPriority ?? ["BGN", "CMPN"], side);
  if (raw == null) return [null, source];
  const shift = n.nodeSpreadBps ?? 0;
  if (RATE_TYPES.includes(n.quoteType)) return [raw + shift / 100.0, source]; // bps -> %
  return [raw + shift, source]; // puntos FX / UF / basis en sus unidades
}
