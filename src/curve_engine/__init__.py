"""curve_engine: motor de construccion de curvas estilo Bloomberg (ICVS/SWPM).

Arquitectura en 4 capas desacopladas:
  1. feed.MarketFeedManager    -> ingesta multi-proveedor + fallback.
  2. nodes.MarketNode          -> reglas microestructurales por ticker.
  3. curves.{NativeCurve,InheritedCurve} -> objeto Curva polimorfico (ex-ante).
  4. router.LegCurveRouter      -> asignacion de curvas por pata segun CSA.

pricing.SwapManager valoriza tickets vanilla usando el ruteo de curvas.
"""
from __future__ import annotations

from .builder import CurveGraphBuilder
from .conventions import (
    BusinessDayConvention,
    DayCount,
    Frequency,
    InterpolationMode,
    QuoteSide,
    QuoteType,
    SpreadStage,
)
from .curves import BaseCurve, InheritedCurve, NativeCurve
from .feed import MarketFeedManager, ProviderQuote
from .nodes import MarketNode
from .pricing import SwapLeg, SwapManager, SwapResult, SwapTicket
from .router import LegCurveAssignment, LegCurveRouter, LegRoutingKey

__all__ = [
    "CurveGraphBuilder",
    "BusinessDayConvention", "DayCount", "Frequency", "InterpolationMode",
    "QuoteSide", "QuoteType", "SpreadStage",
    "BaseCurve", "InheritedCurve", "NativeCurve",
    "MarketFeedManager", "ProviderQuote",
    "MarketNode",
    "SwapLeg", "SwapManager", "SwapResult", "SwapTicket",
    "LegCurveAssignment", "LegCurveRouter", "LegRoutingKey",
]

__version__ = "0.1.0"
