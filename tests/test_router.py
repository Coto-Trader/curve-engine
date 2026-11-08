import pytest


def test_irs_clp_csa_usd_routing(system):
    a = system.router.resolve("CLP", "CLICP", "USD")
    assert a.forecast_curve.curve_id == "193"
    assert a.discount_curve.curve_id == "423"


def test_irs_clp_csa_clp_single_curve(system):
    a = system.router.resolve("CLP", "CLICP", "CLP")
    assert a.forecast_curve.curve_id == "193"
    assert a.discount_curve.curve_id == "193"


def test_fixed_leg_has_no_forecast(system):
    a = system.router.resolve("CLP", "FIXED", "USD")
    assert a.forecast_curve is None
    assert a.discount_curve.curve_id == "423"


def test_unknown_key_raises(system):
    with pytest.raises(KeyError):
        system.router.resolve("JPY", "TONA", "USD")
