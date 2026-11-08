"""Capa 4: mantenedor de monedas y asignador de curvas por pata.

Como todas las curvas se construyen ex-ante, el valorizador solo pregunta por
la llave (moneda de la pata, indice de la pata, moneda del CSA) y recibe el par
(curva de estimacion, curva de descuento). Cambiar el colateral de un ticket no
toca ni una linea de las curvas: solo cambia la fila de ruteo que aplica.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from .curves import BaseCurve


@dataclass(frozen=True)
class LegRoutingKey:
    leg_currency: str   # "CLP", "USD", "EUR", "CLF"
    leg_index: str      # "FIXED", "CLICP", "SOFR", "ESTR", "EURIBOR_6M"
    csa_currency: str   # "USD", "CLP", "EUR", "NONE"


@dataclass
class LegCurveAssignment:
    forecast_curve: Optional[BaseCurve]  # Curva A: estimacion de flujos flotantes
    discount_curve: BaseCurve            # Curva B: descuento colateralizado


class LegCurveRouter:
    def __init__(self, registry: Dict[str, BaseCurve]) -> None:
        self.registry = registry
        self._rules: Dict[LegRoutingKey, Tuple[Optional[str], str]] = {}

    def register_rule(
        self,
        leg_ccy: str,
        leg_index: str,
        csa_ccy: str,
        forecast_curve_id: Optional[str],
        discount_curve_id: str,
    ) -> None:
        key = LegRoutingKey(leg_ccy.upper(), leg_index.upper(), csa_ccy.upper())
        self._rules[key] = (forecast_curve_id, discount_curve_id)

    def resolve(self, leg_ccy: str, leg_index: str, csa_ccy: str) -> LegCurveAssignment:
        key = LegRoutingKey(leg_ccy.upper(), leg_index.upper(), csa_ccy.upper())
        if key not in self._rules:
            raise KeyError(f"No hay regla de ruteo para {key}")
        f_id, d_id = self._rules[key]
        forecast = self.registry[f_id] if f_id else None
        return LegCurveAssignment(forecast_curve=forecast, discount_curve=self.registry[d_id])

    def known_keys(self):
        return list(self._rules.keys())
