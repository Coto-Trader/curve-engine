from datetime import date

from curve_engine.calendars import Calendar
from curve_engine.conventions import DayCount
from curve_engine.daycount import year_fraction


def _spot(system):
    return Calendar(["USNY", "CLSA"]).spot_date(system.val_date, 2)


def test_all_curves_built(system):
    for cid in ["490", "193", "423"]:
        assert system.registry[cid].is_built
        assert system.registry[cid].get_df(system.val_date) == 1.0


def test_discount_factors_monotone_decreasing(system):
    cal = Calendar(["USNY", "CLSA"])
    spot = _spot(system)
    for cid in ["490", "193", "423"]:
        curve = system.registry[cid]
        prev = 1.0
        for t in ["3M", "6M", "1Y", "2Y", "5Y", "10Y"]:
            df = curve.get_df(cal.add_tenor(spot, t))
            assert 0.0 < df < prev, f"{cid} {t} DF={df} no es decreciente"
            prev = df


def test_zero_rates_reasonable(system):
    cal = Calendar(["USNY", "CLSA"])
    d5y = cal.add_tenor(_spot(system), "5Y")
    z490 = system.registry["490"].get_zero_rate(d5y)
    z193 = system.registry["193"].get_zero_rate(d5y)
    assert 2.0 < z490 < 8.0
    assert 2.0 < z193 < 10.0
    # CLP por encima de USD a 5Y con estos datos semilla
    assert z193 > z490


def test_cash_node_roundtrip(system):
    # El nodo 1D de la 490 (SOFR cash 3.92%, ACT/360) debe reproducir su DF.
    cal_usny = Calendar(["USNY"])
    spot = cal_usny.spot_date(system.val_date, 2)
    on = cal_usny.add_tenor(spot, "1D")
    df = system.registry["490"].get_df(on)
    tau = year_fraction(system.val_date, on, DayCount.ACT_360)
    implied = (1.0 / df - 1.0) / tau * 100.0
    assert abs(implied - 3.92) < 0.20  # dentro de ~20bps por efecto spot/val date


def test_ccs_basis_par_zero_mtm(system):
    # El CCBS de mercado (pata local = indice + basis, con principal) debe valer
    # ~0 descontado con la 423: es la condicion que resuelve el solver par.
    from curve_engine.calendars import Calendar, _add_months
    from curve_engine.conventions import DayCount
    from curve_engine.daycount import year_fraction

    reg = system.registry
    cal = Calendar(["USNY", "CLSA"])
    vd = system.val_date
    for ten, bps in [("2Y", -71.5), ("5Y", -55.0), ("10Y", -45.0), ("20Y", -38.0)]:
        mat = cal.add_tenor(cal.spot_date(vd, 2), ten)
        bounds = [vd]
        k = 1
        while True:
            d = _add_months(vd, 12 * k)
            if d >= mat:
                break
            bounds.append(cal.adjust(d))
            k += 1
        bounds.append(mat)
        b = bps / 1e4
        loc = 0.0
        for i in range(1, len(bounds)):
            t0, t1 = bounds[i - 1], bounds[i]
            fwd = reg["193"].get_df(t0) / reg["193"].get_df(t1) - 1.0
            alpha = year_fraction(t0, t1, DayCount.ACT_360)
            loc += (fwd + b * alpha) * reg["423"].get_df(t1)
        loc += reg["423"].get_df(mat) - 1.0
        assert abs(loc) < 1e-9, f"{ten}: residual par del CCBS = {loc}"


def test_inherited_423_between_parents_short_end(system):
    # En el tramo corto, la 423 nace de la 490 por CIP; debe ser un DF valido (<1).
    cal = Calendar(["USNY", "CLSA"])
    d6m = cal.add_tenor(_spot(system), "6M")
    df423 = system.registry["423"].get_df(d6m)
    assert 0.90 < df423 < 1.0
