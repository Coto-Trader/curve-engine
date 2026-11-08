"""Cargador del grafo de curvas desde archivos de configuracion.

Lee `curves_master_config.json` (definicion de curvas + ruteo) y un snapshot de
mercado (`market_*.json`), y arma el feed, las curvas (nativas/heredadas) ya
construidas ex-ante y el LegCurveRouter. Agregar una curva o una regla es editar
JSON, no codigo.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Dict, List

from .builder import CurveGraphBuilder
from .calendars import Calendar
from .conventions import DayCount, Frequency, QuoteType
from .curves import BaseCurve, InheritedCurve, NativeCurve
from .feed import MarketFeedManager
from .nodes import MarketNode
from .router import LegCurveRouter

_TYPE_MAP = {
    "CASH": QuoteType.CASH_RATE,
    "OIS_SWAP": QuoteType.OIS_SWAP,
    "IBOR_SWAP": QuoteType.IBOR_SWAP,
    "FX_FWD_PTS": QuoteType.FX_FWD_POINTS,
    "INF_FWD_UF": QuoteType.INFLATION_FWD_UF,
    "CCS_BASIS": QuoteType.CCS_BASIS_SPREAD,
}
_FREQ_MAP = {
    "Z": Frequency.ZERO, "M": Frequency.MONTHLY, "Q": Frequency.QUARTERLY,
    "S/A": Frequency.SEMI_ANNUAL, "A": Frequency.ANNUAL,
}
_DC_MAP = {
    "ACT/360": DayCount.ACT_360, "ACT/365": DayCount.ACT_365, "30/360": DayCount.THIRTY_360,
}


@dataclass
class CurveSystem:
    val_date: date
    feed: MarketFeedManager
    registry: Dict[str, BaseCurve]
    router: LegCurveRouter
    spot_fx: Dict[str, float]


def _node_from_cfg(cfg_node: dict, curve_cfg: dict) -> MarketNode:
    return MarketNode(
        tenor=cfg_node["tenor"],
        ticker=cfg_node["ticker"],
        quote_type=_TYPE_MAP[cfg_node["type"]],
        day_count=_DC_MAP.get(cfg_node.get("day_count", curve_cfg.get("day_count", "ACT/360"))),
        freq=_FREQ_MAP.get(cfg_node.get("freq", "Z")),
        calendars=list(curve_cfg.get("calendars", ["CLSA"])),
        spot_lag_days=int(curve_cfg.get("spot_lag", 2)),
        points_scale=float(cfg_node.get("points_scale", 1.0)),
        node_spread_bps=float(cfg_node.get("spread_bps", 0.0)),
    )


def load_curve_system(
    config_path: str | Path,
    market_path: str | Path,
) -> CurveSystem:
    cfg = json.loads(Path(config_path).read_text(encoding="utf-8"))
    mkt = json.loads(Path(market_path).read_text(encoding="utf-8"))
    val_date = date.fromisoformat(mkt["valuation_date"])
    spot_fx = dict(mkt["spot_fx"])

    # 1. Feed
    feed = MarketFeedManager()
    for ticker, mid in mkt["quotes"].items():
        if mid is not None:
            feed.ingest_simple(ticker, float(mid))

    builder = CurveGraphBuilder(feed)
    curves_cfg = cfg["curves"]

    # 2. Primera pasada: curvas nativas + contenedores puente (bridge)
    native: Dict[str, NativeCurve] = {}
    bridges: Dict[str, List[MarketNode]] = {}
    for cid, c in curves_cfg.items():
        klass = c["class"].upper()
        if klass == "NATIVE":
            nodes = [_node_from_cfg(n, c) for n in c["nodes"]]
            curve = NativeCurve(cid, c["name"], c["currency"], val_date, nodes)
            native[cid] = curve
            builder.register(curve)
        elif klass == "BRIDGE":
            bridges[cid] = [_node_from_cfg(n, c) for n in c["nodes"]]

    # 3. Segunda pasada: curvas heredadas
    for cid, c in curves_cfg.items():
        if c["class"].upper() != "INHERITED":
            continue
        parent_col = native[c["parent_collateral"]]
        parent_loc = native[c["parent_local"]]
        bridge_nodes = bridges[c["bridge"]]
        bridge_cfg = curves_cfg[c["bridge"]]
        cal = Calendar(bridge_cfg.get("calendars", ["CLSA"]))
        spot = cal.spot_date(val_date, int(bridge_cfg.get("spot_lag", 2)))
        cutoff_date = cal.add_tenor(spot, c.get("cutoff", "18M"))
        spot_val = spot_fx[c["spot_fx"]]
        curve = InheritedCurve(
            cid, c["name"], c["currency"], val_date,
            parent_collateral=parent_col, parent_local=parent_loc,
            bridge_nodes=bridge_nodes, spot_fx=spot_val, cutoff_date=cutoff_date,
        )
        builder.register(curve)

    # 4. Construccion ex-ante del grafo completo
    registry = builder.build_all()

    # 5. Ruteo por pata
    router = LegCurveRouter(registry)
    for r in cfg.get("routing", []):
        router.register_rule(
            r["leg_ccy"], r["leg_index"], r["csa"], r.get("forecast"), r["discount"],
        )

    return CurveSystem(val_date, feed, registry, router, spot_fx)


def default_paths() -> tuple[Path, Path]:
    """Rutas a los archivos de datos incluidos en el repo."""
    root = Path(__file__).resolve().parents[2]
    return root / "data" / "curves_master_config.json", root / "data" / "market_2026_11_07.json"
