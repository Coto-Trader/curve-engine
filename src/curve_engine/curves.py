"""Capa 3: objeto Curva polimorfico (patron Composite).

BaseCurve      -> interfaz comun: get_df / get_zero_rate / get_forward_rate.
NativeCurve    -> se construye desde MarketNodes (tickers): 490, 193, 514, ...
InheritedCurve -> se construye desde DOS curvas padre + nodos puente
                  (FX fwd / basis / inflacion): 423, 440, 403, ...

Toda curva se reduce a una malla de Discount Factors cero cupon {date: DF}.
Interpolacion por defecto: log-lineal en DF == forward instantaneo plano por
tramo (equivalente a 'Step Forward (Cont)' de Bloomberg).
"""
from __future__ import annotations

import math
from abc import ABC, abstractmethod
from datetime import date
from typing import Dict, List, Optional

from .conventions import DayCount, Frequency, InterpolationMode, QuoteType, SpreadStage
from .daycount import year_fraction
from .feed import MarketFeedManager
from .nodes import MarketNode


class BaseCurve(ABC):
    def __init__(self, curve_id: str, name: str, currency: str, val_date: date) -> None:
        self.curve_id = curve_id
        self.name = name
        self.currency = currency
        self.val_date = val_date
        self.parallel_shift_bps: float = 0.0
        self.spread_stage: SpreadStage = SpreadStage.PRE_BOOTSTRAP_PAR
        self.interpolation: InterpolationMode = InterpolationMode.LOG_LINEAR_DF
        self._pillars: Dict[date, float] = {val_date: 1.0}
        self._sorted_dates: List[date] = [val_date]
        self.is_built: bool = False

    # -- construccion (cada subclase la implementa) --------------------
    @abstractmethod
    def build(self, feed: MarketFeedManager) -> None:
        ...

    def _set_pillar(self, d: date, df: float) -> None:
        self._pillars[d] = max(df, 1e-12)

    def _finalize(self) -> None:
        self._sorted_dates = sorted(self._pillars.keys())
        self.is_built = True

    # -- consultas -----------------------------------------------------
    def get_df(self, target: date) -> float:
        if not self.is_built:
            raise RuntimeError(f"Curva {self.curve_id} no construida (build ex-ante pendiente).")
        base = self._raw_df(target)
        if (
            self.spread_stage == SpreadStage.POST_BOOTSTRAP_ZERO
            and self.parallel_shift_bps != 0.0
        ):
            tau = year_fraction(self.val_date, target, DayCount.ACT_365)
            base *= math.exp(-(self.parallel_shift_bps / 10000.0) * tau)
        return base

    def _raw_df(self, target: date) -> float:
        if target <= self.val_date:
            return 1.0
        pil = self._pillars
        if target in pil:
            return pil[target]
        sd = self._sorted_dates
        if target > sd[-1]:  # extrapolacion flat-forward continua
            d_last = sd[-1]
            t_last = year_fraction(self.val_date, d_last, DayCount.ACT_365)
            z_last = -math.log(pil[d_last]) / t_last
            t_tgt = year_fraction(self.val_date, target, DayCount.ACT_365)
            return math.exp(-z_last * t_tgt)
        # interpolacion log-lineal en DF entre pilares vecinos
        lo, hi = self._bracket(target)
        ln0, ln1 = math.log(pil[lo]), math.log(pil[hi])
        w = (target - lo).days / max((hi - lo).days, 1)
        return math.exp(ln0 + w * (ln1 - ln0))

    def _bracket(self, target: date):
        sd = self._sorted_dates
        lo = sd[0]
        for d in sd:
            if d > target:
                return lo, d
            lo = d
        return lo, sd[-1]

    def get_zero_rate(self, target: date, dc: DayCount = DayCount.ACT_365) -> float:
        """Tasa cero continua anualizada (en %)."""
        if target <= self.val_date:
            return 0.0
        tau = year_fraction(self.val_date, target, dc)
        return (-math.log(self.get_df(target)) / tau) * 100.0

    def get_forward_rate(
        self, d1: date, d2: date, dc: DayCount = DayCount.ACT_360
    ) -> float:
        """Tasa forward simple entre d1 y d2 (en %), base `dc`."""
        tau = year_fraction(d1, d2, dc)
        if tau <= 0:
            return 0.0
        return ((self.get_df(d1) / self.get_df(d2)) - 1.0) / tau * 100.0

    def pillars(self) -> Dict[date, float]:
        return dict(self._pillars)


# --------------------------------------------------------------------------
# Curva nativa (bootstrapping directo de tickers)
# --------------------------------------------------------------------------
class NativeCurve(BaseCurve):
    def __init__(
        self,
        curve_id: str,
        name: str,
        currency: str,
        val_date: date,
        nodes: List[MarketNode],
    ) -> None:
        super().__init__(curve_id, name, currency, val_date)
        self.nodes = sorted(nodes, key=lambda n: n.compute_maturity(val_date))

    def build(self, feed: MarketFeedManager) -> None:
        self._pillars = {self.val_date: 1.0}
        self._sorted_dates = [self.val_date]
        for node in self.nodes:
            if not node.enabled:
                continue
            quote, _src = node.effective_quote(feed)
            if quote is None:  # nodo con error (ej. CHN15M vacio) -> se salta
                continue
            if self.spread_stage == SpreadStage.PRE_BOOTSTRAP_PAR:
                quote += self.parallel_shift_bps / 100.0
            df = self._df_for_node(node, quote / 100.0)
            self._set_pillar(node.compute_maturity(self.val_date), df)
            self._sorted_dates = sorted(self._pillars.keys())
        self._finalize()

    def _df_for_node(self, node: MarketNode, r: float) -> float:
        maturity = node.compute_maturity(self.val_date)
        spot = node.spot_date(self.val_date)
        schedule = self._coupon_schedule(node, spot, maturity)
        # Pago unico (cash O/N, cero cupon, o swap con un solo periodo <= 1 cupon)
        if node.freq == Frequency.ZERO or node.quote_type == QuoteType.CASH_RATE or len(schedule) <= 1:
            tau = year_fraction(self.val_date, maturity, node.day_count)
            return 1.0 / (1.0 + r * tau)
        # Bootstrapping recursivo par-swap (proyeccion == descuento en curva pura)
        annuity_prev = 0.0
        prev = spot
        for cpn in schedule[:-1]:
            alpha = year_fraction(prev, cpn, node.day_count)
            annuity_prev += alpha * self._raw_df(cpn)
            prev = cpn
        alpha_n = year_fraction(prev, maturity, node.day_count)
        return (1.0 - r * annuity_prev) / (1.0 + r * alpha_n)

    @staticmethod
    def _coupon_schedule(node: MarketNode, spot: date, maturity: date) -> List[date]:
        """Fechas de pago generadas hacia atras desde el vencimiento (backward roll)."""
        months = node.freq.months
        if months <= 0:
            return [maturity]
        cal = node.calendar()
        dates: List[date] = []
        # cuenta cuantos periodos caben
        from .calendars import _add_months  # import local para evitar ciclo
        k = 1
        while True:
            raw = _add_months(maturity, -months * k)
            if raw <= spot:
                break
            dates.append(cal.adjust(raw, node.roll_convention))
            k += 1
        dates = sorted(set(dates))
        dates.append(maturity)
        return dates


# --------------------------------------------------------------------------
# Curva heredada (puente de colateral cruzado)
# --------------------------------------------------------------------------
class InheritedCurve(BaseCurve):
    """Curva de descuento colateralizada construida desde dos curvas padre.

    Ejemplo 423 (CLP Col USD):
        parent_collateral = 490 (USD SOFR)   -> base del colateral
        parent_local      = 193 (CLP Camara) -> proyeccion local / ancla larga
        bridge_nodes      = nodos de la 194  -> FX fwd (corto) + CCS basis (largo)

    Tramo corto (<= cutoff): paridad cubierta de tasas (CIP) exacta
        DF_col(T) = DF_490(T) * (S0 / F(T)),   F(T) = S0 + puntos
    Tramo largo (>= cutoff): SOLVER CCS PAR nodo a nodo (ver
        _solve_basis_par_node): despeja DF_col(T_N) para que el cross-currency
        basis swap de mercado valorice a cero (Zero-MtM a t0), descontando la
        pata local con la curva desconocida y la pata base con su curva OIS.
        Reemplaza la vieja aproximacion DF_193*exp(-basis*tau).
    """

    def __init__(
        self,
        curve_id: str,
        name: str,
        currency: str,
        val_date: date,
        parent_collateral: BaseCurve,
        parent_local: BaseCurve,
        bridge_nodes: List[MarketNode],
        spot_fx: float,
        cutoff_date: date,
    ) -> None:
        super().__init__(curve_id, name, currency, val_date)
        self.parent_col = parent_collateral
        self.parent_loc = parent_local
        self.bridge_nodes = sorted(bridge_nodes, key=lambda n: n.compute_maturity(val_date))
        self.spot_fx = spot_fx
        self.cutoff_date = cutoff_date

    def build(self, feed: MarketFeedManager) -> None:
        if not self.parent_col.is_built:
            self.parent_col.build(feed)
        if not self.parent_loc.is_built:
            self.parent_loc.build(feed)
        self._pillars = {self.val_date: 1.0}
        self._sorted_dates = [self.val_date]
        for node in self.bridge_nodes:
            if not node.enabled:
                continue
            val, _src = node.effective_quote(feed)
            if val is None:
                continue
            mat = node.compute_maturity(self.val_date)
            if node.quote_type == QuoteType.FX_FWD_POINTS and mat <= self.cutoff_date:
                df_base = self.parent_col.get_df(mat)
                fwd = self.spot_fx + val * node.points_scale
                df = df_base * (self.spot_fx / fwd)
            elif node.quote_type == QuoteType.CCS_BASIS_SPREAD and mat >= self.cutoff_date:
                # Solver CCS par (ver _solve_basis_par_node): despeja DF_d(T_N)
                # para que el cross-currency basis swap de mercado valga 0.
                df = self._solve_basis_par_node(node, mat, val / 10000.0)
            else:
                # Nodo fuera del tramo que le corresponde (segun cutoff): se ignora.
                continue
            self._set_pillar(mat, df)
            self._sorted_dates = sorted(self._pillars.keys())
        self._finalize()

    def _solve_basis_par_node(self, node: MarketNode, mat: date, b: float) -> float:
        """Despeje par del cross-currency basis swap.

        La pata base (USD SOFR flat, proyectada y descontada con la misma curva
        OIS, con intercambio de principal) vale par (=0) bajo colateral USD, por
        lo que el swap vale 0 sii la pata local (indice local + basis b, con
        principal) tambien vale 0, descontada con la curva desconocida DF_d:

            sum_i (fwd_loc_i + b*alpha_i) DF_d(t_i) + DF_d(T_N) - 1 = 0

        con fwd_loc_i = DF_loc(t_{i-1})/DF_loc(t_i) - 1. Se resuelve DF_d(T_N) por
        biseccion; los nodos intermedios entre el ultimo pilar y T_N se
        interpolan log-lineal contra el valor de prueba. b en decimal.
        """
        from .calendars import _add_months

        cal = node.calendar()
        dc = node.day_count
        roll = node.roll_convention
        freq_months = node.freq.months or 12

        bounds: List[date] = [self.val_date]
        k = 1
        while True:
            d = _add_months(self.val_date, freq_months * k)
            if d >= mat:
                break
            bounds.append(cal.adjust(d, roll))
            k += 1
        bounds.append(mat)

        last_date = self._sorted_dates[-1]
        last_df = self._raw_df(last_date)

        def df_trial(t: date, x: float) -> float:
            if t == mat:
                return x
            if t <= last_date:
                return self._raw_df(t)
            w = (t - last_date).days / max((mat - last_date).days, 1)
            return math.exp(math.log(last_df) + w * (math.log(x) - math.log(last_df)))

        def g(x: float) -> float:
            s = 0.0
            for i in range(1, len(bounds)):
                t0, t1 = bounds[i - 1], bounds[i]
                fwd_loc = self.parent_loc.get_df(t0) / self.parent_loc.get_df(t1) - 1.0
                alpha = year_fraction(t0, t1, dc)
                s += (fwd_loc + b * alpha) * df_trial(t1, x)
            return s + x - 1.0

        lo, hi = 1e-9, 1.2
        if g(lo) > 0:
            return lo
        if g(hi) < 0:
            return hi
        for _ in range(200):
            mid = 0.5 * (lo + hi)
            if g(mid) > 0:
                hi = mid
            else:
                lo = mid
            if hi - lo < 1e-14:
                break
        return 0.5 * (lo + hi)
