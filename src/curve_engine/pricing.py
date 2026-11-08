"""SwapManager: valorizacion de un IRS (vanilla) bajo el estandar multi-curva.

Pata flotante (OIS / Camara ICP) valorizada por replicacion de factores de
descuento de la curva de proyeccion; descuento con la curva colateralizada que
asigna el LegCurveRouter segun el CSA del ticket.

Convencion de signo: el NPV se reporta desde la perspectiva de quien RECIBE la
pata fija (recibe fija, paga flotante). receive_fixed=False invierte el signo.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional, Tuple

from .calendars import Calendar, _add_months
from .conventions import BusinessDayConvention, DayCount, Frequency
from .curves import BaseCurve
from .daycount import year_fraction
from .router import LegCurveRouter


@dataclass
class CouponPeriod:
    accrual_start: date
    accrual_end: date
    pay_date: date

    def alpha(self, dc: DayCount) -> float:
        return year_fraction(self.accrual_start, self.accrual_end, dc)


def generate_schedule(
    effective: date,
    maturity: date,
    freq: Frequency,
    calendars: List[str],
    conv: BusinessDayConvention = BusinessDayConvention.MODIFIED_FOLLOWING,
    pay_delay_days: int = 0,
) -> List[CouponPeriod]:
    """Calendario de cupones generado hacia atras desde el vencimiento."""
    cal = Calendar(calendars)
    months = freq.months
    if months <= 0:  # pago unico
        pay = cal.advance_business_days(cal.adjust(maturity, conv), pay_delay_days)
        return [CouponPeriod(effective, cal.adjust(maturity, conv), pay)]

    raw_dates: List[date] = []
    k = 1
    while True:
        raw = _add_months(maturity, -months * k)
        if raw <= effective:
            break
        raw_dates.append(raw)
        k += 1
    boundaries = [effective] + [cal.adjust(d, conv) for d in sorted(raw_dates)] + [cal.adjust(maturity, conv)]
    periods: List[CouponPeriod] = []
    for i in range(1, len(boundaries)):
        a_start, a_end = boundaries[i - 1], boundaries[i]
        pay = cal.advance_business_days(a_end, pay_delay_days)
        periods.append(CouponPeriod(a_start, a_end, pay))
    return periods


@dataclass
class SwapLeg:
    currency: str
    leg_index: str                 # "FIXED", "CLICP", "SOFR", ...
    notional: float
    pay_freq: Frequency
    day_count: DayCount = DayCount.ACT_360
    calendars: List[str] = field(default_factory=lambda: ["CLSA"])
    fixed_rate_pct: Optional[float] = None   # solo pata fija (en %)
    spread_bps: float = 0.0                  # spread sobre la flotante
    pay_delay_days: int = 0

    @property
    def is_fixed(self) -> bool:
        return self.leg_index.upper() == "FIXED"


@dataclass
class SwapTicket:
    val_date: date
    effective_date: date
    maturity_date: date
    leg_fixed: SwapLeg
    leg_float: SwapLeg
    csa_currency: str = "USD"
    receive_fixed: bool = True

    conv: BusinessDayConvention = BusinessDayConvention.MODIFIED_FOLLOWING


@dataclass
class LegValuation:
    pv: float
    annuity: float          # Sum alpha_i * DF_disc (por unidad de nocional * tasa)
    periods: int


@dataclass
class SwapResult:
    npv: float
    fixed: LegValuation
    float_: LegValuation
    par_rate_pct: float
    dv01: float             # analitico: cambio de PV de la pata fija por 1 bp


class SwapManager:
    def __init__(self, router: LegCurveRouter) -> None:
        self.router = router

    # -- pata fija -----------------------------------------------------
    def value_fixed_leg(self, leg: SwapLeg, ticket: SwapTicket) -> LegValuation:
        assign = self.router.resolve(leg.currency, "FIXED", ticket.csa_currency)
        disc = assign.discount_curve
        periods = generate_schedule(
            ticket.effective_date, ticket.maturity_date, leg.pay_freq,
            leg.calendars, ticket.conv, leg.pay_delay_days,
        )
        annuity = 0.0
        for p in periods:
            annuity += p.alpha(leg.day_count) * disc.get_df(p.pay_date)
        rate = (leg.fixed_rate_pct or 0.0) / 100.0
        pv = leg.notional * rate * annuity
        return LegValuation(pv=pv, annuity=leg.notional * annuity, periods=len(periods))

    # -- pata flotante (OIS / Camara) ----------------------------------
    def value_float_leg(self, leg: SwapLeg, ticket: SwapTicket) -> LegValuation:
        assign = self.router.resolve(leg.currency, leg.leg_index, ticket.csa_currency)
        proj = assign.forecast_curve
        disc = assign.discount_curve
        if proj is None:
            raise ValueError(f"Pata flotante {leg.leg_index} sin curva de proyeccion.")
        periods = generate_schedule(
            ticket.effective_date, ticket.maturity_date, leg.pay_freq,
            leg.calendars, ticket.conv, leg.pay_delay_days,
        )
        pv = 0.0
        annuity = 0.0
        spread = leg.spread_bps / 10000.0
        for p in periods:
            df_pay = disc.get_df(p.pay_date)
            # tasa forward compuesta del indice via replicacion de DF de proyeccion
            fwd_growth = proj.get_df(p.accrual_start) / proj.get_df(p.accrual_end) - 1.0
            alpha = p.alpha(leg.day_count)
            pv += leg.notional * (fwd_growth + spread * alpha) * df_pay
            annuity += alpha * df_pay
        return LegValuation(pv=pv, annuity=leg.notional * annuity, periods=len(periods))

    # -- swap completo -------------------------------------------------
    def price(self, ticket: SwapTicket) -> SwapResult:
        fixed = self.value_fixed_leg(ticket.leg_fixed, ticket)
        flt = self.value_float_leg(ticket.leg_float, ticket)
        # NPV desde la perspectiva de quien recibe fija
        raw = fixed.pv - flt.pv
        npv = raw if ticket.receive_fixed else -raw
        # tasa par: iguala PV fija a PV flotante
        par = (flt.pv / fixed.annuity * 100.0) if fixed.annuity else 0.0
        # DV01 analitico de la pata fija (cambio de PV por 1 bp en la tasa fija)
        dv01 = fixed.annuity * 1e-4
        return SwapResult(npv=npv, fixed=fixed, float_=flt, par_rate_pct=par, dv01=dv01)
