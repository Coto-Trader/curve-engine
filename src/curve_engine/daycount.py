"""Fracciones de ano (year fractions) por convencion de conteo de dias."""
from __future__ import annotations

from datetime import date

from .conventions import DayCount


def year_fraction(d1: date, d2: date, dc: DayCount = DayCount.ACT_365) -> float:
    """Fraccion de ano entre d1 y d2 bajo la convencion `dc`.

    Devuelve 0.0 si d2 <= d1 (nunca negativa).
    """
    if d2 <= d1:
        return 0.0
    if dc == DayCount.ACT_360:
        return (d2 - d1).days / 360.0
    if dc == DayCount.ACT_365:
        return (d2 - d1).days / 365.0
    if dc == DayCount.THIRTY_360:
        # 30/360 US (Bond Basis)
        d1d = min(d1.day, 30)
        d2d = d2.day
        if d1d == 30 and d2d == 31:
            d2d = 30
        return (
            360 * (d2.year - d1.year)
            + 30 * (d2.month - d1.month)
            + (d2d - d1d)
        ) / 360.0
    raise ValueError(f"DayCount no soportado: {dc}")
