from datetime import date

from curve_engine.calendars import Calendar, _add_months
from curve_engine.conventions import BusinessDayConvention as BDC


def test_weekend_is_not_business_day():
    cal = Calendar(["CLSA"])
    assert not cal.is_business_day(date(2026, 11, 7))   # sabado
    assert not cal.is_business_day(date(2026, 11, 8))   # domingo
    assert cal.is_business_day(date(2026, 11, 9))       # lunes


def test_modified_following_stays_in_month():
    cal = Calendar(["USNY"])
    # 2026-05-31 es domingo -> following saltaria a junio -> modified vuelve atras
    adj = cal.adjust(date(2026, 5, 31), BDC.MODIFIED_FOLLOWING)
    assert adj.month == 5
    assert cal.is_business_day(adj)


def test_add_tenor_months_and_years():
    cal = Calendar(["USNY", "CLSA"])
    start = date(2026, 11, 10)
    assert cal.add_tenor(start, "6M").month in (5, 6)  # ~ mayo 2027 ajustado
    assert cal.add_tenor(start, "2Y").year == 2028


def test_add_months_end_of_month():
    assert _add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert _add_months(date(2026, 12, 15), 1) == date(2027, 1, 15)


def test_spot_date_t2():
    cal = Calendar(["USNY", "CLSA"])
    # 2026-11-09 lunes; el 11 es Veterans Day (USNY) -> T+2 salta a jueves 12.
    assert cal.spot_date(date(2026, 11, 9), 2) == date(2026, 11, 12)
    # Con calendario solo CL (sin feriado US) el T+2 cae el miercoles 11.
    assert Calendar(["CLSA"]).spot_date(date(2026, 11, 9), 2) == date(2026, 11, 11)
