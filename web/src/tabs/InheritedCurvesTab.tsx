import { useState } from "react";
import { useStore } from "../state/store";
import { CurveCfg } from "../engine";
import { fmtDf, fmtPct, sampleCurve } from "../ui/util";

export function InheritedCurvesTab() {
  const { config, update, system } = useStore();
  const inherited = config.curves.filter((c) => c.kind === "INHERITED" || c.kind === "INFLATION_DISC");
  const allCurves = config.curves.filter((c) => c.kind !== "BRIDGE"); // posibles padres (nativas o heredadas)
  const bridges = config.curves.filter((c) => c.kind === "BRIDGE");
  const fxKeys = Object.keys(config.spotFx);
  const [sel, setSel] = useState(inherited[0]?.id ?? "");
  const curve = config.curves.find((c) => c.id === sel);

  function patch(fn: (c: CurveCfg) => void) {
    update((d) => { const c = d.curves.find((x) => x.id === sel); if (c) fn(c); return d; });
  }

  const built = system.registry[sel];
  const samples = built ? sampleCurve(built, system.valDate) : [];

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>4 · Creador de Curvas Heredadas</h2>
        <span className="hint">dos curvas padre (nativas o heredadas) + puente → recursivo</span>
        <span className="spacer" />
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          {inherited.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}
        </select>
        <button className="btn" onClick={() => update((d) => {
          const id = "H" + Math.floor(Math.random() * 900 + 100);
          d.curves.push({ id, name: "NUEVA_HEREDADA", currency: "CLP", kind: "INHERITED", parentCollateral: "490", parentLocal: "193", bridge: "194", spotFxKey: "USDCLP", cutoff: "18M" });
          return d;
        })}>+ Heredada</button>
      </div>

      {!curve ? <div className="empty">Crea una curva heredada.</div> : (
        <div className="panel-body">
          <div className="grid c3" style={{ marginBottom: 12 }}>
            <label className="field"><span className="lbl">Nombre</span>
              <input value={curve.name} onChange={(e) => patch((c) => { c.name = e.target.value; })} /></label>
            <label className="field"><span className="lbl">Moneda</span>
              <input value={curve.currency} onChange={(e) => patch((c) => { c.currency = e.target.value; })} /></label>
            <label className="field"><span className="lbl">Cutoff FX fwd</span>
              <input value={curve.cutoff ?? "18M"} onChange={(e) => patch((c) => { c.cutoff = e.target.value; })} /></label>
          </div>
          <div className="grid c4" style={{ marginBottom: 14 }}>
            <label className="field"><span className="lbl">Padre colateral</span>
              <select value={curve.parentCollateral ?? ""} onChange={(e) => patch((c) => { c.parentCollateral = e.target.value; })}>
                {allCurves.filter((x) => x.id !== sel).map((x) => <option key={x.id} value={x.id}>{x.id} · {x.name}</option>)}
              </select></label>
            <label className="field"><span className="lbl">Padre local/proyección</span>
              <select value={curve.parentLocal ?? ""} onChange={(e) => patch((c) => { c.parentLocal = e.target.value; })}>
                {allCurves.filter((x) => x.id !== sel).map((x) => <option key={x.id} value={x.id}>{x.id} · {x.name}</option>)}
              </select></label>
            <label className="field"><span className="lbl">Puente (basis/inflación)</span>
              <select value={curve.bridge ?? ""} onChange={(e) => patch((c) => { c.bridge = e.target.value; })}>
                {bridges.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.name}</option>)}
              </select></label>
            <label className="field"><span className="lbl">Spot FX</span>
              <select value={curve.spotFxKey ?? ""} onChange={(e) => patch((c) => { c.spotFxKey = e.target.value; })}>
                {fxKeys.map((k) => <option key={k} value={k}>{k}</option>)}
              </select></label>
          </div>

          <div className="notice" style={{ marginBottom: 14 }}>
            <span className="tree-line">
              {curve.id} ({curve.name})<br />
              ├── colateral → {curve.parentCollateral} [{kindOf(config, curve.parentCollateral)}]<br />
              ├── local/proy → {curve.parentLocal} [{kindOf(config, curve.parentLocal)}]<br />
              └── puente → {curve.bridge} (FX fwd ≤ {curve.cutoff} + CCS basis ≥ cutoff)
            </span>
          </div>

          <div className="panel-head" style={{ padding: "0 0 8px" }}>
            <h2 style={{ fontSize: 12 }}>Salida — DF / tasa cero</h2>
            <span className="spacer" />
            {built ? <span className="badge inherited">INHERITED · construida</span> : <span className="badge warn">no construida</span>}
          </div>
          {samples.length > 0 ? (
            <table className="tbl">
              <thead><tr><th>Tenor</th><th className="num">DF</th><th className="num">Zero %</th></tr></thead>
              <tbody>{samples.map((s) => (
                <tr key={s.tenor}><td>{s.tenor}</td><td className="num">{fmtDf(s.df)}</td><td className="num">{fmtPct(s.zero, 4)}</td></tr>
              ))}</tbody>
            </table>
          ) : <div className="empty">Revisa padres/puente: la curva no se construyó.</div>}
        </div>
      )}
    </div>
  );
}

function kindOf(config: { curves: CurveCfg[] }, id?: string): string {
  return config.curves.find((c) => c.id === id)?.kind ?? "?";
}
