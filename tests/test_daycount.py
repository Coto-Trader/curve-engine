from datetime import date

from curve_engine.conventions import DayCount
from curve_engine.daycount import year_fraction


def test_act360_vs_act365():
    d1, d2 = date(2026, 1, 1), date(2027, 1, 1)
    assert year_fraction(d1, d2, DayCount.ACT_360) == 365 / 360
    assert year_fraction(d1, d2, DayCount.ACT_365) == 1.0


def test_non_negative_and_zero():
    d1, d2 = date(2026, 6, 1), date(2026, 1, 1)
    assert year_fraction(d1, d2, DayCount.ACT_360) == 0.0
    assert year_fraction(d1, d1) == 0.0


def test_thirty_360():
    d1, d2 = date(2026, 1, 1), date(2026, 7, 1)
    assert abs(year_fraction(d1, d2, DayCount.THIRTY_360) - 0.5) < 1e-12
