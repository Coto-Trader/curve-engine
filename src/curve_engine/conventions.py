"""Enumeraciones y convenciones parametrizables del motor de curvas.

Todas las reglas microestructurales (base de dias, frecuencia, tipo de
instrumento, etapa de aplicacion de spread, convencion de calendario) se
modelan como enums para que ninguna curva quede "en duro".
"""
from __future__ import annotations

from enum import Enum


class DayCount(str, Enum):
    ACT_360 = "ACT/360"
    ACT_365 = "ACT/365"
    THIRTY_360 = "30/360"


class Frequency(str, Enum):
    ZERO = "Z"          # Pago unico al vencimiento (cero cupon)
    MONTHLY = "M"
    QUARTERLY = "Q"
    SEMI_ANNUAL = "S/A"
    ANNUAL = "A"

    @property
    def periods_per_year(self) -> int:
        return {
            Frequency.ZERO: 0,
            Frequency.MONTHLY: 12,
            Frequency.QUARTERLY: 4,
            Frequency.SEMI_ANNUAL: 2,
            Frequency.ANNUAL: 1,
        }[self]

    @property
    def months(self) -> int:
        """Meses entre cupones (0 para cero cupon)."""
        return {
            Frequency.ZERO: 0,
            Frequency.MONTHLY: 1,
            Frequency.QUARTERLY: 3,
            Frequency.SEMI_ANNUAL: 6,
            Frequency.ANNUAL: 12,
        }[self]


class QuoteType(str, Enum):
    CASH_RATE = "CASH"              # Deposito O/N (TPM, SOFR, ESTR)
    OIS_SWAP = "OIS_SWAP"          # Swap OIS (SOFR, Camara ICP, ESTR)
    IBOR_SWAP = "IBOR_SWAP"        # Swap contra IBOR (Euribor 6M)
    FX_FWD_POINTS = "FX_FWD_PTS"   # Puntos forward NDF (USDCLP, EURUSD)
    INFLATION_FWD_UF = "INF_FWD_UF"  # Forward de inflacion UF (outright)
    CCS_BASIS_SPREAD = "CCS_BASIS"  # Cross-currency basis spread (bps)


class BusinessDayConvention(str, Enum):
    FOLLOWING = "FOLLOWING"
    MODIFIED_FOLLOWING = "MODIFIED_FOLLOWING"
    PRECEDING = "PRECEDING"
    MODIFIED_PRECEDING = "MODIFIED_PRECEDING"
    UNADJUSTED = "UNADJUSTED"


class SpreadStage(str, Enum):
    """Donde se aplica el shifter/spread de una curva.

    PRE_BOOTSTRAP_PAR  -> se suma a la tasa par ANTES del bootstrapping.
                          Captura convexidad (asi calcula Bloomberg el Market DV01).
    POST_BOOTSTRAP_ZERO -> se traslada la tasa cero continua ya construida.
                          Traslacion limpia (ideal para spread de fondeo / FVA / credito).
    """
    PRE_BOOTSTRAP_PAR = "PRE_BOOTSTRAP"
    POST_BOOTSTRAP_ZERO = "POST_BOOTSTRAP"


class InterpolationMode(str, Enum):
    LOG_LINEAR_DF = "LOG_LINEAR_DF"          # Lineal en ln(DF) == forward constante por tramo
    LINEAR_ZERO = "LINEAR_ZERO"              # Lineal en tasa cero continua
    FLAT_FORWARD = "FLAT_FORWARD"            # Forward instantaneo plano (equivalente a log-linear DF)


class QuoteSide(str, Enum):
    MID = "MID"
    BID = "BID"
    ASK = "ASK"
