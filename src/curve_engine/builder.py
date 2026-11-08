"""Constructor del grafo de curvas ex-ante (CurveGraphBuilder).

Mantiene el registro {curve_id -> BaseCurve} y las construye en cascada: las
curvas heredadas disparan la construccion de sus padres (recursividad del
grafo), de modo que el orden de registro no importa. Es un DAG: si se detecta
un ciclo, se levanta un error.
"""
from __future__ import annotations

from typing import Dict, List

from .curves import BaseCurve, InheritedCurve
from .feed import MarketFeedManager


class CurveGraphBuilder:
    def __init__(self, feed: MarketFeedManager) -> None:
        self.feed = feed
        self.registry: Dict[str, BaseCurve] = {}

    def register(self, curve: BaseCurve) -> BaseCurve:
        self.registry[curve.curve_id] = curve
        return curve

    def _dependencies(self, curve: BaseCurve) -> List[str]:
        if isinstance(curve, InheritedCurve):
            return [curve.parent_col.curve_id, curve.parent_loc.curve_id]
        return []

    def build_all(self) -> Dict[str, BaseCurve]:
        visiting: set[str] = set()
        done: set[str] = set()

        def _build(cid: str) -> None:
            if cid in done:
                return
            if cid in visiting:
                raise ValueError(f"Ciclo detectado en el grafo de curvas en {cid}")
            visiting.add(cid)
            curve = self.registry[cid]
            for dep in self._dependencies(curve):
                if dep not in self.registry:
                    raise KeyError(f"Curva {cid} depende de {dep}, no registrada.")
                _build(dep)
            if not curve.is_built:
                curve.build(self.feed)
            visiting.discard(cid)
            done.add(cid)

        for cid in list(self.registry.keys()):
            _build(cid)
        return self.registry
