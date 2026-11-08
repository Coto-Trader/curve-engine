"""Capa 1: ingesta de precios con multiples proveedores y resiliencia.

MarketFeedManager resuelve, por ticker:
  1. Override manual digitado en pantalla (prioridad absoluta).
  2. Lista priorizada de proveedores (BGN, CMPN, broker local, ...).
  3. Ultimo precio bueno conocido (LKG snapshot) si todo falla.

El objetivo es que un nodo que viene vacio o "pegado" no rompa la curva:
el constructor simplemente salta el nodo o cae al fallback configurado.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .conventions import QuoteSide


@dataclass
class ProviderQuote:
    provider: str
    bid: Optional[float] = None
    ask: Optional[float] = None
    timestamp: str = ""
    is_healthy: bool = True

    @property
    def mid(self) -> Optional[float]:
        if self.bid is not None and self.ask is not None:
            return 0.5 * (self.bid + self.ask)
        return self.bid if self.bid is not None else self.ask

    def value(self, side: QuoteSide) -> Optional[float]:
        if side == QuoteSide.BID:
            return self.bid if self.bid is not None else self.mid
        if side == QuoteSide.ASK:
            return self.ask if self.ask is not None else self.mid
        return self.mid


class MarketFeedManager:
    def __init__(self) -> None:
        # {ticker: {provider: ProviderQuote}}
        self._quotes: Dict[str, Dict[str, ProviderQuote]] = {}
        self._manual: Dict[str, float] = {}
        self._lkg: Dict[str, float] = {}

    # -- ingesta -------------------------------------------------------
    def ingest(self, ticker: str, quote: ProviderQuote) -> None:
        self._quotes.setdefault(ticker, {})[quote.provider] = quote
        m = quote.mid
        if quote.is_healthy and m is not None and not math.isnan(m):
            self._lkg[ticker] = m

    def ingest_simple(self, ticker: str, mid: float, provider: str = "SEED") -> None:
        """Atajo: carga un unico mid como bid=ask=mid."""
        self.ingest(ticker, ProviderQuote(provider=provider, bid=mid, ask=mid,
                                           timestamp="", is_healthy=True))

    def set_manual_override(self, ticker: str, value: Optional[float]) -> None:
        if value is None:
            self._manual.pop(ticker, None)
        else:
            self._manual[ticker] = value

    # -- resolucion ----------------------------------------------------
    def resolve(
        self,
        ticker: str,
        provider_priority: List[str],
        side: QuoteSide = QuoteSide.MID,
        use_lkg_on_fail: bool = True,
    ) -> Tuple[Optional[float], str]:
        """Devuelve (precio, fuente). fuente in {MANUAL_OVERRIDE, <provider>,
        LKG_FALLBACK, MISSING_ERROR}."""
        if ticker in self._manual:
            return self._manual[ticker], "MANUAL_OVERRIDE"
        pmap = self._quotes.get(ticker, {})
        for prov in provider_priority:
            q = pmap.get(prov)
            if q and q.is_healthy:
                v = q.value(side)
                if v is not None and not math.isnan(v):
                    return v, prov
        if use_lkg_on_fail and ticker in self._lkg:
            return self._lkg[ticker], "LKG_FALLBACK"
        return None, "MISSING_ERROR"
