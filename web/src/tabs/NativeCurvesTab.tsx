import { useState } from "react";
import { useStore } from "../state/store";
import { CurveCfg, QuoteType, Frequency } from "../engine";
import { fmtDf, fmtPct, sampleCurve } from "../ui/util";

const QTYPES: QuoteType[] = ["CASH", "OIS_SWAP", "IBOR_SWAP", "FX_FWD_PTS", "CCS_BASIS", "INF_FWD_UF", "UF_REAL_SWAP"];
const FREQS: Frequency[] = ["Z", "M", "Q", "S/A", "A"];

export function NativeCurvesTab() {
  const { config, update, system } = useStore();
  const curves = config.curves.filter((c) => c.kind === "NATIVE" || c.kind === "BRIDGE" || c.kind === "INFLATION_FWD");
  const [sel, setSel] = useState(curves[0]?.id ?? "");
  const curve = config.curves.find((c) => c.id === sel);
  const idx = config.curves.findIndex((c) => c.id === sel);

  function patch(fn: (c: CurveCfg) => void) {
    update((d) => { const c = d.curves.find((x) => x.id === sel); if (c) fn(c); return d; });
  }

  const built = system.registry[sel];
  const samples = curve && curve.kind !== "BRIDGE" && built?.isBuilt
    ? sampleCurve(built, system.valDate)
    : [];
  const isInfl = curve?.kind === "INFLATION_FWD";

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>3 · Mantenedor de Curvas Directas</h2>
        <span className="hint">curvas nativas (se arman de tickers) + puentes</span>
        <span className="spacer" />
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          {curves.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name} [{c.kind}]</option>)}
        </select>
        <button className="btn" onClick={() => update((d) => {
          const id = "NEW" + Math.floor(Math.random() * 900 + 100);
          d.curves.push({ id, name: "NUEVA", currency: "CLP", kind: "NATIVE", calendars: ["CLSA"], spotLag: 2, dayCount: "ACT/360", interpolation: "LOG_LINEAR_DF", nodes: [] });
          return d;
        })}>+ Curva</button>
      </div>

      {!curve ? <div className="empty">Selecciona una curva.</div> : (
        <div className="panel-body">
          <div className="grid c4" style={{ marginBottom: 14 }}>
            <label className="field"><span className="lbl">Nombre</span>
              <input value={curve.name} onChange={(e) => patch((c) => { c.name = e.target.value; })} /></label>
            <label className="field"><span className="lbl">Moneda</span>
              <input value={curve.currency} onChange={(e) => patch((c) => { c.currency = e.target.value; })} /></label>
            <label className="field"><span className="lbl">Calendarios</span>
              <input value={(curve.calendars ?? []).join(",")} onChange={(e) => patch((c) => { c.calendars = e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean); })} /></label>
            <label className="field"><span className="lbl">Spot lag</span>
              <input type="number" value={curve.spotLag ?? 2} onChange={(e) => patch((c) => { c.spotLag = parseInt(e.target.value || "0", 10); })} /></label>
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 520px", minWidth: 320 }}>
              <div className="panel-head" style={{ padding: "0 0 8px" }}>
                <h2 style={{ fontSize: 12 }}>Nodos ({curve.nodes?.length ?? 0})</h2>
                <span className="spacer" />
                <button className="btn" onClick={() => patch((c) => { (c.nodes ??= []).push({ tenor: "1Y", ticker: "TICKER", type: "OIS_SWAP", freq: "Z" }); })}>+ Nodo</button>
              </div>
              <table className="tbl">
                <thead><tr><th>Tenor</th><th>Ticker</th><th>Tipo</th><th>Freq</th><th className="num">Shift bps</th><th>On</th><th></th></tr></thead>
                <tbody>
                  {(curve.nodes ?? []).map((n, ni) => (
                    <tr key={ni}>
                      <td><input value={n.tenor} style={{ width: 54 }} onChange={(e) => patch((c) => { c.nodes![ni].tenor = e.target.value; })} /></td>
                      <td><input value={n.ticker} style={{ width: 110 }} onChange={(e) => patch((c) => { c.nodes![ni].ticker = e.target.value; })} /></td>
                      <td>
                        <select value={n.type} onChange={(e) => patch((c) => { c.nodes![ni].type = e.target.value as QuoteType; })}>
                          {QTYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={n.freq} onChange={(e) => patch((c) => { c.nodes![ni].freq = e.target.value as Frequency; })}>
                          {FREQS.map((f) => <option key={f}>{f}</option>)}
                        </select>
                      </td>
                      <td className="num"><input type="number" step="0.5" value={n.spreadBps ?? 0} style={{ width: 64 }} onChange={(e) => patch((c) => { c.nodes![ni].spreadBps = parseFloat(e.target.value || "0"); })} /></td>
                      <td><input type="checkbox" checked={n.enabled !== false} onChange={(e) => patch((c) => { c.nodes![ni].enabled = e.target.checked; })} /></td>
                      <td><button className="btn ghost danger" onClick={() => patch((c) => { c.nodes!.splice(ni, 1); })}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ flex: "1 1 320px", minWidth: 280 }}>
              <div className="panel-head" style={{ padding: "0 0 8px" }}>
                <h2 style={{ fontSize: 12 }}>{isInfl ? "Salida — 1/g · inflación" : "Salida — DF / tasa cero"}</h2>
                <span className="spacer" />
                {curve.kind === "BRIDGE"
                  ? <span className="badge warn">puente (alimenta heredadas)</span>
                  : built?.isBuilt
                    ? <span className={`badge ${isInfl ? "inherited" : "native"}`}>{isInfl ? "INFLACIÓN" : "NATIVE"} · construida</span>
                    : <span className="badge warn">no construida</span>}
              </div>
              {samples.length > 0 ? (
                <table className="tbl">
                  <thead><tr><th>Tenor</th><th className="num">{isInfl ? "1/g" : "DF"}</th><th className="num">{isInfl ? "Infl %" : "Zero %"}</th></tr></thead>
                  <tbody>
                    {samples.map((s) => (
                      <tr key={s.tenor}><td>{s.tenor}</td><td className="num">{fmtDf(s.df)}</td><td className="num">{fmtPct(s.zero, 4)}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="notice">Las curvas puente (p.ej. 194) no son curvas de descuento por sí solas: aportan sus nodos (FX fwd / basis) a una curva heredada como la 423.</div>}
            </div>
          </div>

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn danger" onClick={() => { if (confirm(`Borrar curva ${sel}?`)) { update((d) => { d.curves.splice(idx, 1); return d; }); setSel(curves[0]?.id ?? ""); } }}>Borrar curva</button>
          </div>
        </div>
      )}
    </div>
  );
}
