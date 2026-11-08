"""Capa 2: nodo de mercado con reglas microestructurales (MarketNode).

Cada observacion (ticker) sabe su propia convencion: base de dias, frecuencia,
calendarios, lag de spot, pay delay y de que proveedores leerse. Tambien aplica
su shifter individual (node_spread_bps), que por defecto es 0.0.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional, Tuple

from .calendars import Calendar
from .conventions import (
    BusinessDayConvention,
    DayCount,
    Frequency,
    QuoteSide,
    QuoteType,
)
from .feed import MarketFeedManager

# Tipos de quote cuyo shifter se expresa en bps sobre una tasa en %
_RATE_TYPES = {QuoteType.CASH_RATE, QuoteType.OIS_SWAP, QuoteType.IBOR_SWAP}


@dataclass
class MarketNode:
    tenor: str
    ticker: str
    quote_type: QuoteType
    day_count: DayCount = DayCount.ACT_360
    freq: Frequency = Frequency.ZERO
    calendars: List[str] = field(default_factory=lambda: ["CLSA"])
    spot_lag_days: int = 2
    fixing_lag_days: int = 0
    pay_delay_days: int = 0
    roll_convention: BusinessDayConvention = BusinessDayConvention.MODIFIED_FOLLOWING
    provider_priority: List[str] = field(default_factory=lambda: ["BGN", "CMPN", "MANUAL"])
    node_spread_bps: float = 0.0
    points_scale: float = 1.0      # escala de puntos FX (1 o 10000 segun cotizacion)
    enabled: bool = True
    maturity_date: Optional[date] = None  # override explicito

    # -- fechas --------------------------------------------------------
    def calendar(self) -> Calendar:
        return Calendar(self.calendars)

    def compute_maturity(self, val_date: date) -> date:
        """Fecha de vencimiento = spot(val_date, lag) + tenor, ajustada.

        Si se fijo maturity_date explicita, se respeta.
        """
        if self.maturity_date is not None:
            return self.maturity_date
        cal = self.calendar()
        spot = cal.spot_date(val_date, self.spot_lag_days)
        return cal.add_tenor(spot, self.tenor, self.roll_convention)

    def spot_date(self, val_date: date) -> date:
        return self.calendar().spot_date(val_date, self.spot_lag_days)

    # -- precio efectivo (con shifter) ---------------------------------
    def effective_quote(
        self,
        feed: MarketFeedManager,
        side: QuoteSide = QuoteSide.MID,
    ) -> Tuple[Optional[float], str]:
        raw, source = feed.resolve(self.ticker, self.provider_priority, side)
        if raw is None:
            return None, source
        if self.quote_type in _RATE_TYPES:
            return raw + (self.node_spread_bps / 100.0), source  # bps -> %
        # Puntos FX / UF outright / basis: el shifter va en las unidades del quote
        return raw + self.node_spread_bps, source
