import { useStore } from "../state/store";

export function ProductsTab() {
  const { config, update, system } = useStore();
  const curveIds = Object.keys(system.registry);

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>5a · Mantenedor de Productos</h2>
          <span className="hint">IRS / CCS · patas, índices y colaterales permitidos</span>
          <span className="spacer" />
          <button className="btn" onClick={() => update((d) => {
            d.products.push({ id: "PROD" + (d.products.length + 1), name: "Nuevo producto", kind: "IRS",
              legA: { ccy: "CLP", index: "FIXED", freq: "S/A", dayCount: "ACT/360", calendars: ["USNY", "CLSA"] },
              legB: { ccy: "CLP", index: "CLICP", freq: "S/A", dayCount: "ACT/360", calendars: ["USNY", "CLSA"] },
              allowedCollaterals: ["USD", "CLP", "NONE"] });
            return d;
          })}>+ Producto</button>
        </div>
        <div className="panel-body" style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Pata A</th><th>Pata B</th><th>Colaterales</th><th></th></tr></thead>
            <tbody>
              {config.products.map((p, i) => (
                <tr key={i}>
                  <td><input value={p.name} style={{ width: 170 }} onChange={(e) => update((d) => { d.products[i].name = e.target.value; return d; })} /></td>
                  <td>
                    <select value={p.kind} onChange={(e) => update((d) => { d.products[i].kind = e.target.value as "IRS" | "CCS"; return d; })}>
                      <option>IRS</option><option>CCS</option>
                    </select>
                  </td>
                  <td className="dim">{p.legA.ccy} · {p.legA.index} · {p.legA.freq}</td>
                  <td className="dim">{p.legB.ccy} · {p.legB.index} · {p.legB.freq}</td>
                  <td>
                    <input value={p.allowedCollaterals.join(",")} style={{ width: 120 }}
                      onChange={(e) => update((d) => { d.products[i].allowedCollaterals = e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean); return d; })} />
                  </td>
                  <td><button className="btn ghost danger" onClick={() => update((d) => { d.products.splice(i, 1); return d; })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>5b · Lógica de Curvas por Pata (Router)</h2>
          <span className="hint">(moneda, índice, CSA) → curva de estimación + descuento</span>
          <span className="spacer" />
          <button className="btn" onClick={() => update((d) => {
            d.routing.push({ legCcy: "CLP", legIndex: "FIXED", csa: "USD", forecast: null, discount: curveIds[0] ?? "" });
            return d;
          })}>+ Regla</button>
        </div>
        <div className="panel-body" style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Moneda pata</th><th>Índice</th><th>CSA</th><th>Estimación</th><th>Descuento</th><th></th></tr></thead>
            <tbody>
              {config.routing.map((r, i) => (
                <tr key={i}>
                  <td><input value={r.legCcy} style={{ width: 60 }} onChange={(e) => update((d) => { d.routing[i].legCcy = e.target.value.toUpperCase(); return d; })} /></td>
                  <td><input value={r.legIndex} style={{ width: 80 }} onChange={(e) => update((d) => { d.routing[i].legIndex = e.target.value.toUpperCase(); return d; })} /></td>
                  <td><input value={r.csa} style={{ width: 60 }} onChange={(e) => update((d) => { d.routing[i].csa = e.target.value.toUpperCase(); return d; })} /></td>
                  <td>
                    <select value={r.forecast ?? ""} onChange={(e) => update((d) => { d.routing[i].forecast = e.target.value || null; return d; })}>
                      <option value="">— (pata fija)</option>
                      {curveIds.map((id) => <option key={id} value={id}>{id}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={r.discount} onChange={(e) => update((d) => { d.routing[i].discount = e.target.value; return d; })}>
                      {curveIds.map((id) => <option key={id} value={id}>{id}</option>)}
                    </select>
                  </td>
                  <td><button className="btn ghost danger" onClick={() => update((d) => { d.routing.splice(i, 1); return d; })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
