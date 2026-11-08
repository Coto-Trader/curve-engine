from curve_engine.pricing import SwapManager
from curve_engine.scripts_entry import build_demo_ticket


def test_par_swap_is_zero_mtm(system):
    mgr = SwapManager(system.router)
    base = mgr.price(build_demo_ticket(system, "5Y", fixed_rate_pct=0.0, csa="USD"))
    par = base.par_rate_pct
    assert 3.0 < par < 8.0
    at_par = mgr.price(build_demo_ticket(system, "5Y", fixed_rate_pct=par, csa="USD"))
    # Valorizado a su propia tasa par el NPV debe anularse.
    assert abs(at_par.npv) < 1e-3


def test_dv01_matches_offmarket_npv(system):
    mgr = SwapManager(system.router)
    par = mgr.price(build_demo_ticket(system, "5Y", 0.0, "USD")).par_rate_pct
    off = mgr.price(build_demo_ticket(system, "5Y", par + 0.25, "USD"))
    # 25 bps * DV01 debe igualar el NPV fuera de mercado (linealidad de la pata fija).
    assert abs(25 * off.dv01 - off.npv) < 1e-2
    assert off.npv > 0  # recibe fija por encima de par -> NPV positivo


def test_collateral_switch_changes_npv(system):
    mgr = SwapManager(system.router)
    par = mgr.price(build_demo_ticket(system, "5Y", 0.0, "USD")).par_rate_pct
    usd = mgr.price(build_demo_ticket(system, "5Y", par, "USD"))
    clp = mgr.price(build_demo_ticket(system, "5Y", par, "CLP"))
    # Cambiar el colateral (423 -> 193) mueve el NPV: el router hace su trabajo.
    assert abs(clp.npv - usd.npv) > 1.0


def test_par_rate_varies_by_tenor(system):
    mgr = SwapManager(system.router)
    p2 = mgr.price(build_demo_ticket(system, "2Y", 0.0, "USD")).par_rate_pct
    p10 = mgr.price(build_demo_ticket(system, "10Y", 0.0, "USD")).par_rate_pct
    assert p2 != p10
