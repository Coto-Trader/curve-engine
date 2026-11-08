import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { Calendar, SwapLeg, SwapTicket, toISO } from "../engine";
import { fmtCcy, fmtDf, fmtPct, sampleCurve, STD_TENORS } from "../ui/util";

const TENORS = ["1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "15Y", "20Y"];

export function ValuationTab() {
  const { config, system } = useStore();
  // Ticket pre-cargado por URL (p.ej. desde TradeSwap):
  //   ?product=IRS_CLP_CAM&csa=USD&tenor=5Y&notional=10000000000&rate=5.1
  const qp = new URLSearchParams(location.search);
  const qProduct = qp.get("product");
  const qRate = parseFloat(qp.get("rate") ?? "");
  const [productId, setProductId] = useState(
    () => (config.products.find((x) => x.id === qProduct) ? qProduct! : config.products[0]?.id ?? "")
  );
  const [csa, setCsa] = useState(() => (qp.get("csa") || "USD").toUpperCase());
  const [tenor, setTenor] = useState(() => qp.get("tenor") || "5Y");
  const [notional, setNotional] = useState(() => {
    const n = parseFloat(qp.get("notional") ?? "");
    return isFinite(n) && n > 0 ? n : 10_000_000_000;
  });
  const [receiveA, setReceiveA] = useState(qp.get("receive") !== "pay");
  const [useParRate, setUseParRate] = useState(!isFinite(qRate));
  const [manualRate, setManualRate] = useState(isFinite(qRate) ? qRate : 5.0);

  const product = config.products.find((p) => p.id === productId);

  const result = useMemo(() => {
    if (!product || !system.swapManager) return null;
    try {
      const mgr = system.swapManager;
      const calA = new Calendar(product.legA.calendars);
      const spot = calA.spotDate(system.valDate, 2);
      const maturity = calA.addTenor(spot, tenor);
      const fxAB = mgr.fxTo(product.legA.ccy) / mgr.fxTo(product.legB.ccy);

      const mkLeg = (side: "A" | "B", fixedRate: number): SwapLeg => {
        const l = side === "A" ? product.legA : product.legB;
        return {
          currency: l.ccy, legIndex: l.index, payFreq: l.freq, dayCount: l.dayCount, calendars: l.calendars,
          notional: side === "A" ? notional : (product.kind === "CCS" ? notional * fxAB : notional),
          fixedRatePct: l.index.toUpperCase() === "FIXED" ? fixedRate : undefined,
          spreadBps: 0,
        };
      };
      const mkTicket = (rate: number): SwapTicket => ({
        valDate: system.valDate, effectiveDate: spot, maturityDate: maturity,
        legA: mkLeg("A", rate), legB: mkLeg("B", rate), csaCurrency: csa, receiveA, conv: "MODIFIED_FOLLOWING",
      });

      const probe = mgr.price(mkTicket(0));
      const par = probe.parRatePct;
      const rate = useParRate && par != null ? par : manualRate;
      const res = mgr.price(mkTicket(rate));
      return { res, par, rate, spot, maturity };
    } catch (e) {
      return { error: (e as Error).message } as any;
    }
  }, [product, csa, tenor, notional, receiveA, useParRate, manualRate, system]);

  // curvas usadas (para feed XVA)
  const usedCurves = useMemo(() => {
    if (!product || !system.router) return [];
    const ids = new Set<string>();
    for (const l of [product.legA, product.legB]) {
      try {
        const a = system.router.resolve(l.ccy, l.index.toUpperCase() === "FIXED" ? "FIXED" : l.index, csa);
        ids.add(a.discountCurve.curveId);
        if (a.forecastCurve) ids.add(a.forecastCurve.curveId);
      } catch { /* sin regla */ }
    }
    return [...ids];
  }, [product, csa, system]);

  function exportXvaFeed() {
    const grid = Object.fromEntries(usedCurves.map((id) => {
      const c = system.registry[id];
      return [id, sampleCurve(c, system.valDate, [...STD_TENORS, "25Y", "30Y"]).map((s) => ({ date: s.dateISO, df: s.df, zero_cont_pct: s.zero }))];
    }));
    const payload = { valuation_date: toISO(system.valDate), reporting_ccy: config.reportingCcy, product: product?.id, csa, curves: grid };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `xva_feed_${product?.id}_${csa}.json`;
    a.click();
  }

  const r = result && !("error" in result) ? result : null;

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>6 · Valorizador de Swaps</h2>
          <span className="hint">IRS / CCS · el router asigna estimación y descuento por pata</span>
        </div>
        <div className="panel-body">
          <div className="grid c4" style={{ marginBottom: 14 }}>
            <label className="field"><span className="lbl">Producto</span>
              <select value={productId} onChange={(e) => { setProductId(e.target.value); const p = config.products.find((x) => x.id === e.target.value); if (p && !p.allowedCollaterals.includes(csa)) setCsa(p.allowedCollaterals[0]); }}>
                {config.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <label className="field"><span className="lbl">Colateral (CSA)</span>
              <select value={csa} onChange={(e) => setCsa(e.target.value)}>
                {(product?.allowedCollaterals ?? ["USD"]).map((c) => <option key={c}>{c}</option>)}
              </select></label>
            <label className="field"><span className="lbl">Plazo</span>
              <select value={tenor} onChange={(e) => setTenor(e.target.value)}>{TENORS.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="field"><span className="lbl">Nocional (pata A)</span>
              <input type="number" value={notional} onChange={(e) => setNotional(parseFloat(e.target.value || "0"))} /></label>
          </div>
          <div className="grid c3" style={{ marginBottom: 14 }}>
            <label className="field"><span className="lbl">Tasa fija</span>
              <div className="btn-row">
                <button className={`btn ${useParRate ? "primary" : "ghost"}`} onClick={() => setUseParRate(true)}>Par de mercado</button>
                <button className={`btn ${!useParRate ? "primary" : "ghost"}`} onClick={() => setUseParRate(false)}>Manual</button>
              </div>
            </label>
            {!useParRate && (
              <label className="field"><span className="lbl">Tasa manual %</span>
                <input type="number" step="0.01" value={manualRate} onChange={(e) => setManualRate(parseFloat(e.target.value || "0"))} /></label>
            )}
            <label className="field"><span className="lbl">Dirección</span>
              <div className="btn-row">
                <button className={`btn ${receiveA ? "primary" : "ghost"}`} onClick={() => setReceiveA(true)}>Recibe {product?.legA.ccy} {product?.legA.index}</button>
                <button className={`btn ${!receiveA ? "primary" : "ghost"}`} onClick={() => setReceiveA(false)}>Paga</button>
              </div>
            </label>
          </div>

          {result && "error" in result && <div className="notice"><b>Error:</b> {result.error}</div>}
          {r && (
            <>
              <div className="kpi" style={{ marginBottom: 12 }}>
                <div className="cell"><div className="k">Tasa par</div><div className="v signal">{r.par != null ? fmtPct(r.par, 4) : "—"}</div></div>
                <div className="cell"><div className="k">Tasa usada</div><div className="v">{fmtPct(r.rate, 4)}</div></div>
                <div className="cell"><div className="k">NPV ({r.res.reportingCcy})</div><div className={`v ${r.res.npv >= 0 ? "" : ""}`} style={{ color: r.res.npv >= 0 ? "var(--up)" : "var(--down)" }}>{fmtCcy(r.res.npv)}</div></div>
                <div className="cell"><div className="k">DV01</div><div className="v">{fmtCcy(r.res.dv01)}</div></div>
              </div>
              <table className="tbl">
                <thead><tr><th>Pata</th><th>Moneda</th><th>Índice</th><th className="num">Cupones</th><th className="num">PV (moneda pata)</th></tr></thead>
                <tbody>
                  <tr><td>A {receiveA ? "(recibe)" : "(paga)"}</td><td>{r.res.legA.currency}</td><td>{product?.legA.index}</td><td className="num">{r.res.legA.periods}</td><td className="num">{fmtCcy(r.res.legA.pv)}</td></tr>
                  <tr><td>B {receiveA ? "(paga)" : "(recibe)"}</td><td>{r.res.legB.currency}</td><td>{product?.legB.index}</td><td className="num">{r.res.legB.periods}</td><td className="num">{fmtCcy(r.res.legB.pv)}</td></tr>
                </tbody>
              </table>
              <div className="muted mono" style={{ marginTop: 8, fontSize: 11 }}>
                Spot efectivo {toISO(r.spot)} · Vencimiento {toISO(r.maturity)}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Feed XVA — vectores DF_ZC(t)</h2>
          <span className="hint">curvas normalizadas que alimentan el motor XVA</span>
          <span className="spacer" />
          <button className="btn primary" onClick={exportXvaFeed} disabled={usedCurves.length === 0}>Exportar vector XVA (.JSON)</button>
        </div>
        <div className="panel-body">
          <div style={{ marginBottom: 10 }}>
            {usedCurves.map((id) => <span key={id} className="badge inherited" style={{ marginRight: 6 }}>{id} · {system.registry[id]?.name}</span>)}
            {usedCurves.length === 0 && <span className="muted mono">Sin curvas resueltas para este CSA (revisa el router).</span>}
          </div>
          {usedCurves[0] && system.registry[usedCurves[0]] && (
            <table className="tbl">
              <thead><tr><th>Tenor</th>{usedCurves.map((id) => <th key={id} className="num">DF {id}</th>)}</tr></thead>
              <tbody>
                {STD_TENORS.map((t, i) => (
                  <tr key={t}>
                    <td>{t}</td>
                    {usedCurves.map((id) => {
                      const s = sampleCurve(system.registry[id], system.valDate)[i];
                      return <td key={id} className="num">{fmtDf(s.df)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
