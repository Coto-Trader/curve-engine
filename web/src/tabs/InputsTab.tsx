import { useState } from "react";
import { useStore } from "../state/store";

export function InputsTab() {
  const { config, update } = useStore();
  const [q, setQ] = useState("");
  const rows = config.inputs
    .map((inp, idx) => ({ inp, idx }))
    .filter(({ inp }) => inp.ticker.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>1 · Mantenedor de Inputs</h2>
        <span className="hint">tickers, precios y propiedades · diccionario de datos</span>
        <span className="spacer" />
        <input placeholder="filtrar ticker..." value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 160 }} />
        <button className="btn" onClick={() => update((d) => {
          d.inputs.unshift({ ticker: "NUEVO_TICKER", mid: 0, provider: "MANUAL", description: "" });
          return d;
        })}>+ Input</button>
      </div>
      <div className="panel-body" style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Ticker</th><th className="num">Mid</th><th className="num">Bid</th><th className="num">Ask</th>
              <th>Proveedor</th><th>Descripción</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ inp, idx }) => (
              <tr key={idx}>
                <td>
                  <input value={inp.ticker} style={{ width: 130 }}
                    onChange={(e) => update((d) => { d.inputs[idx].ticker = e.target.value; return d; })} />
                </td>
                <td className="num">
                  <input type="number" step="0.0001" value={inp.mid ?? ""} style={{ width: 90 }}
                    onChange={(e) => update((d) => { d.inputs[idx].mid = e.target.value === "" ? null : parseFloat(e.target.value); return d; })} />
                </td>
                <td className="num">
                  <input type="number" step="0.0001" value={inp.bid ?? ""} style={{ width: 80 }}
                    onChange={(e) => update((d) => { d.inputs[idx].bid = e.target.value === "" ? null : parseFloat(e.target.value); return d; })} />
                </td>
                <td className="num">
                  <input type="number" step="0.0001" value={inp.ask ?? ""} style={{ width: 80 }}
                    onChange={(e) => update((d) => { d.inputs[idx].ask = e.target.value === "" ? null : parseFloat(e.target.value); return d; })} />
                </td>
                <td>
                  <input value={inp.provider ?? ""} style={{ width: 80 }}
                    onChange={(e) => update((d) => { d.inputs[idx].provider = e.target.value; return d; })} />
                </td>
                <td>
                  <input value={inp.description ?? ""} style={{ width: 160 }}
                    onChange={(e) => update((d) => { d.inputs[idx].description = e.target.value; return d; })} />
                </td>
                <td>
                  <button className="btn ghost danger" onClick={() => update((d) => { d.inputs.splice(idx, 1); return d; })}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">Sin inputs que coincidan.</div>}
      </div>
    </div>
  );
}
