"""Demo del slice CLP: construye el grafo de curvas y valoriza un IRS CLP Camara.

Ejecutable con `python -m curve_engine.scripts_entry` o `curve-slice`
(tras `pip install -e .`), o via `python scripts/run_slice.py`.
"""
from __future__ import annotations

from datetime import date

from .calendars import Calendar
from .config import default_paths, load_curve_system
from .conventions import BusinessDayConvention, DayCount, Frequency
from .pricing import SwapLeg, SwapManager, SwapTicket

_TENORS = ["1M", "3M", "6M", "12M", "18M", "2Y", "3Y", "5Y", "10Y", "20Y"]


def _print_curve_table(sys, curve_id: str) -> None:
    curve = sys.registry[curve_id]
    cal = Calendar(["USNY", "CLSA"])
    spot = cal.spot_date(sys.val_date, 2)
    print(f"\nCurva {curve_id} ({curve.name}, {curve.currency})")
    print(f"  {'Tenor':<6}{'Fecha':<13}{'DF':>13}{'Zero cont %':>13}")
    for t in _TENORS:
        d = cal.add_tenor(spot, t)
        df = curve.get_df(d)
        z = curve.get_zero_rate(d, DayCount.ACT_365)
        print(f"  {t:<6}{d.isoformat():<13}{df:>13.8f}{z:>13.5f}")


def build_demo_ticket(sys, maturity_tenor: str = "5Y", fixed_rate_pct: float | None = None,
                      csa: str = "USD", notional: float = 10_000_000_000.0) -> SwapTicket:
    cal = Calendar(["USNY", "CLSA"])
    spot = cal.spot_date(sys.val_date, 2)
    maturity = cal.add_tenor(spot, maturity_tenor)
    fixed = SwapLeg(
        currency="CLP", leg_index="FIXED", notional=notional,
        pay_freq=Frequency.SEMI_ANNUAL, day_count=DayCount.ACT_360,
        calendars=["USNY", "CLSA"], fixed_rate_pct=fixed_rate_pct or 0.0,
    )
    flt = SwapLeg(
        currency="CLP", leg_index="CLICP", notional=notional,
        pay_freq=Frequency.SEMI_ANNUAL, day_count=DayCount.ACT_360,
        calendars=["USNY", "CLSA"],
    )
    return SwapTicket(
        val_date=sys.val_date, effective_date=spot, maturity_date=maturity,
        leg_fixed=fixed, leg_float=flt, csa_currency=csa, receive_fixed=True,
        conv=BusinessDayConvention.MODIFIED_FOLLOWING,
    )


def run_slice() -> None:
    cfg_path, mkt_path = default_paths()
    sys = load_curve_system(cfg_path, mkt_path)

    print("=" * 68)
    print(f"  CURVE ENGINE - Slice CLP   |   Valuation date: {sys.val_date}")
    print(f"  Spot USDCLP = {sys.spot_fx['USDCLP']:.5f}")
    print("=" * 68)
    for cid in ["490", "193", "423"]:
        _print_curve_table(sys, cid)

    mgr = SwapManager(sys.router)

    # 1. Tasa par del IRS CLP Camara 5Y (CSA USD): estimo 193, descuento 423
    at0 = build_demo_ticket(sys, "5Y", fixed_rate_pct=0.0, csa="USD")
    res0 = mgr.price(at0)
    par = res0.par_rate_pct

    print("\n" + "=" * 68)
    print("  IRS CLP CAMARA 5Y  (CSA USD Cash, TH=0)  |  Nocional 10.000MM CLP")
    print("  Forecast = 193 (CLICP)   Discount = 423 (CLP Col USD)")
    print("=" * 68)
    print(f"  Tasa PAR de mercado        : {par:.5f} %")

    # 2. Ticket a tasa par -> NPV ~ 0 (verificacion Zero-MtM del motor)
    at_par = build_demo_ticket(sys, "5Y", fixed_rate_pct=par, csa="USD")
    rp = mgr.price(at_par)
    print(f"  NPV a tasa par             : {rp.npv:,.2f} CLP   (debe ser ~0)")

    # 3. Ticket fuera de mercado (par + 25 bps) -> NPV y DV01
    off = build_demo_ticket(sys, "5Y", fixed_rate_pct=par + 0.25, csa="USD")
    ro = mgr.price(off)
    print(f"  NPV con fija = par+25bps   : {ro.npv:,.2f} CLP  (recibe fija)")
    print(f"  DV01 (pata fija)           : {ro.dv01:,.2f} CLP / bp")
    print(f"  Chequeo: 25bps * DV01      : {25 * ro.dv01:,.2f} CLP  (~ NPV arriba)")

    # 4. Mismo swap pero CSA CLP -> descuenta con 193 (single-curve)
    at_clp = build_demo_ticket(sys, "5Y", fixed_rate_pct=par, csa="CLP")
    rc = mgr.price(at_clp)
    print("\n  --- Impacto del colateral (router por pata) ---")
    print(f"  Misma op a tasa par, CSA CLP (desc 193): NPV = {rc.npv:,.2f} CLP")
    print(f"  Diferencia de descuento (USD vs CLP)    : {rc.npv - rp.npv:,.2f} CLP")
    print("=" * 68)


def run_slice_cli() -> None:  # entry-point de consola
    run_slice()


if __name__ == "__main__":
    run_slice()
