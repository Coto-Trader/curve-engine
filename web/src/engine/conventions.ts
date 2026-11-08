// Enumeraciones / convenciones (strings que coinciden con el motor Python).

export type DayCount = "ACT/360" | "ACT/365" | "30/360";

export type Frequency = "Z" | "M" | "Q" | "S/A" | "A";

export const FREQ_MONTHS: Record<Frequency, number> = {
  Z: 0, M: 1, Q: 3, "S/A": 6, A: 12,
};

export type QuoteType =
  | "CASH"
  | "OIS_SWAP"
  | "IBOR_SWAP"
  | "FX_FWD_PTS"
  | "INF_FWD_UF"
  | "UF_REAL_SWAP"
  | "CCS_BASIS";

export type BusinessDayConvention =
  | "FOLLOWING"
  | "MODIFIED_FOLLOWING"
  | "PRECEDING"
  | "MODIFIED_PRECEDING"
  | "UNADJUSTED";

export type SpreadStage = "PRE_BOOTSTRAP" | "POST_BOOTSTRAP";

export type InterpolationMode = "LOG_LINEAR_DF" | "LINEAR_ZERO" | "FLAT_FORWARD";

export type QuoteSide = "MID" | "BID" | "ASK";

export const RATE_TYPES: QuoteType[] = ["CASH", "OIS_SWAP", "IBOR_SWAP", "UF_REAL_SWAP"];
