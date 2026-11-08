"""Calendarios de dias habiles, ajuste de fechas y aritmetica de tenores.

NOTA DE ALCANCE: las tablas de feriados (CLSA/Santiago y USNY/SIFMA) son
semillas para 2026-2029 con los feriados de fecha fija principales mas los
movibles conocidos de 2026-2027. Para clavar al dia el Fair Value de SWPM se
deben completar los feriados movibles de todos los anos del horizonte de la
curva; por eso cada feriado vive en un dict editable y no esta "en duro" en la
logica. Un dia habil mal puesto mueve un pilar de la curva en un dia.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Dict, Iterable, Set

from .conventions import BusinessDayConvention as BDC

# --------------------------------------------------------------------------
# Tablas de feriados (semilla). Fechas en ISO. Editables / ampliables.
# --------------------------------------------------------------------------
_CLSA_HOLIDAYS: Set[date] = set(
    date.fromisoformat(s)
    for s in [
        # 2026
        "2026-01-01", "2026-04-03", "2026-05-01", "2026-05-21",
        "2026-06-20", "2026-06-29", "2026-07-16", "2026-08-15",
        "2026-09-18", "2026-09-19", "2026-10-12", "2026-10-31",
        "2026-11-01", "2026-12-08", "2026-12-25",
        # 2027
        "2027-01-01", "2027-03-26", "2027-05-01", "2027-05-21",
        "2027-06-21", "2027-06-29", "2027-07-16", "2027-08-15",
        "2027-09-18", "2027-09-19", "2027-10-12", "2027-10-31",
        "2027-11-01", "2027-12-08", "2027-12-25",
        # 2028 (fijos principales)
        "2028-01-01", "2028-05-01", "2028-05-21", "2028-07-16",
        "2028-08-15", "2028-09-18", "2028-09-19", "2028-10-12",
        "2028-11-01", "2028-12-08", "2028-12-25",
    ]
)

_USNY_HOLIDAYS: Set[date] = set(
    date.fromisoformat(s)
    for s in [
        # 2026 (SIFMA / US settlement, aproximado)
        "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25",
        "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12",
        "2026-11-11", "2026-11-26", "2026-12-25",
        # 2027
        "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31",
        "2027-06-18", "2027-07-05", "2027-09-06", "2027-10-11",
        "2027-11-11", "2027-11-25", "2027-12-24",
        # 2028 (fijos principales)
        "2028-01-17", "2028-02-21", "2028-05-29", "2028-06-19",
        "2028-07-04", "2028-09-04", "2028-10-09", "2028-11-23",
        "2028-12-25",
    ]
)

_HOLIDAY_TABLES: Dict[str, Set[date]] = {
    "CLSA": _CLSA_HOLIDAYS,
    "USNY": _USNY_HOLIDAYS,
    "TARGET": set(),  # placeholder EUR (completar en etapa EUR)
}

_TENOR_RE = re.compile(r"^(\d+)\s*([DWMY])$", re.IGNORECASE)


class Calendar:
    """Calendario compuesto: la union de uno o varios centros (CL, FD, ...).

    Un dia es habil solo si lo es en TODOS los centros (convencion de mercado
    para calendarios combinados tipo 'FD, CL').
    """

    def __init__(self, centers: Iterable[str]):
        self.centers = [c.upper() for c in centers]
        self._holidays: Set[date] = set()
        for c in self.centers:
            self._holidays |= _HOLIDAY_TABLES.get(c, set())

    # -- consultas -----------------------------------------------------
    def is_holiday(self, d: date) -> bool:
        return d in self._holidays

    def is_business_day(self, d: date) -> bool:
        return d.weekday() < 5 and d not in self._holidays

    # -- ajuste de fecha ----------------------------------------------
    def adjust(self, d: date, conv: BDC = BDC.MODIFIED_FOLLOWING) -> date:
        if conv == BDC.UNADJUSTED or self.is_business_day(d):
            return d
        if conv in (BDC.FOLLOWING, BDC.MODIFIED_FOLLOWING):
            nd = self._roll(d, +1)
            if conv == BDC.MODIFIED_FOLLOWING and nd.month != d.month:
                return self._roll(d, -1)
            return nd
        # PRECEDING / MODIFIED_PRECEDING
        nd = self._roll(d, -1)
        if conv == BDC.MODIFIED_PRECEDING and nd.month != d.month:
            return self._roll(d, +1)
        return nd

    def _roll(self, d: date, step: int) -> date:
        cur = d
        while not self.is_business_day(cur):
            cur = cur + timedelta(days=step)
        return cur

    def advance_business_days(self, d: date, n: int) -> date:
        """Avanza (o retrocede) `n` dias habiles."""
        cur = d
        step = 1 if n >= 0 else -1
        remaining = abs(n)
        while remaining > 0:
            cur = cur + timedelta(days=step)
            if self.is_business_day(cur):
                remaining -= 1
        return cur

    # -- aritmetica de tenores ----------------------------------------
    def add_tenor(
        self,
        start: date,
        tenor: str,
        conv: BDC = BDC.MODIFIED_FOLLOWING,
    ) -> date:
        """Suma un tenor ('1D','1W','3M','18M','2Y') y ajusta a dia habil.

        - D: dias habiles (overnight / tom-next).
        - W: semanas calendario, luego ajuste.
        - M/Y: meses/anos calendario con manejo de fin de mes, luego ajuste.
        """
        m = _TENOR_RE.match(tenor.strip())
        if not m:
            raise ValueError(f"Tenor invalido: {tenor!r}")
        n = int(m.group(1))
        unit = m.group(2).upper()

        if unit == "D":
            return self.advance_business_days(start, n)
        if unit == "W":
            return self.adjust(start + timedelta(weeks=n), conv)
        if unit == "M":
            return self.adjust(_add_months(start, n), conv)
        if unit == "Y":
            return self.adjust(_add_months(start, 12 * n), conv)
        raise ValueError(f"Unidad de tenor no soportada: {unit}")

    def spot_date(self, trade_date: date, lag_days: int) -> date:
        return self.advance_business_days(trade_date, lag_days)


def _add_months(d: date, months: int) -> date:
    """Suma meses calendario preservando fin de mes cuando aplica."""
    total = (d.year * 12 + (d.month - 1)) + months
    y, m = divmod(total, 12)
    m += 1
    # ultimo dia del mes destino
    if m == 12:
        last = 31
    else:
        last = (date(y, m + 1, 1) - timedelta(days=1)).day
    return date(y, m, min(d.day, last))


def register_holidays(center: str, days: Iterable[date]) -> None:
    """Amplia una tabla de feriados en caliente (para refinar calendarios)."""
    _HOLIDAY_TABLES.setdefault(center.upper(), set()).update(days)
