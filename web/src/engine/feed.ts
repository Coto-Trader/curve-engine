import { QuoteSide } from "./conventions";

export interface ProviderQuote {
  provider: string;
  bid?: number | null;
  ask?: number | null;
  timestamp?: string;
  isHealthy?: boolean;
}

export function quoteMid(q: ProviderQuote): number | null {
  if (q.bid != null && q.ask != null) return 0.5 * (q.bid + q.ask);
  if (q.bid != null) return q.bid;
  if (q.ask != null) return q.ask;
  return null;
}

function quoteValue(q: ProviderQuote, side: QuoteSide): number | null {
  if (side === "BID") return q.bid != null ? q.bid : quoteMid(q);
  if (side === "ASK") return q.ask != null ? q.ask : quoteMid(q);
  return quoteMid(q);
}

/** Ingesta multi-proveedor + override manual + fallback LKG (Capa 1). */
export class MarketFeedManager {
  private quotes = new Map<string, Map<string, ProviderQuote>>();
  private manual = new Map<string, number>();
  private lkg = new Map<string, number>();

  ingest(ticker: string, q: ProviderQuote): void {
    if (!this.quotes.has(ticker)) this.quotes.set(ticker, new Map());
    this.quotes.get(ticker)!.set(q.provider, q);
    const m = quoteMid(q);
    if ((q.isHealthy ?? true) && m != null && !Number.isNaN(m)) this.lkg.set(ticker, m);
  }

  ingestSimple(ticker: string, mid: number, provider = "SEED"): void {
    this.ingest(ticker, { provider, bid: mid, ask: mid, isHealthy: true });
  }

  setManualOverride(ticker: string, value: number | null): void {
    if (value == null) this.manual.delete(ticker);
    else this.manual.set(ticker, value);
  }

  resolve(
    ticker: string,
    providerPriority: string[],
    side: QuoteSide = "MID",
    useLkgOnFail = true
  ): [number | null, string] {
    if (this.manual.has(ticker)) return [this.manual.get(ticker)!, "MANUAL_OVERRIDE"];
    const pmap = this.quotes.get(ticker);
    if (pmap) {
      for (const prov of providerPriority) {
        const q = pmap.get(prov);
        if (q && (q.isHealthy ?? true)) {
          const v = quoteValue(q, side);
          if (v != null && !Number.isNaN(v)) return [v, prov];
        }
      }
    }
    if (useLkgOnFail && this.lkg.has(ticker)) return [this.lkg.get(ticker)!, "LKG_FALLBACK"];
    return [null, "MISSING_ERROR"];
  }
}
