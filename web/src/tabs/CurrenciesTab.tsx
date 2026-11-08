import { useStore } from "../state/store";

export function CurrenciesTab() {
  const { config, update } = useStore();
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>2 · Creación de Monedas</h2>
        <span className="hint">código, calendarios, índices flotantes y lag de spot</span>
        <span className="spacer" />
        <button className="btn" onClick={() => update((d) => {
          d.currencies.push({ code: "XXX", name: "Nueva moneda", calendars: ["CLSA"], indices: [], spotLag: 2 });
          return d;
        })}>+ Moneda</button>
      </div>
      <div className="panel-body" style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr><th>Código</th><th>Nombre</th><th>Calendarios</th><th>Índices</th><th className="num">Spot lag</th><th></th></tr>
          </thead>
          <tbody>
            {config.currencies.map((c, idx) => (
              <tr key={idx}>
                <td><input value={c.code} style={{ width: 60 }} onChange={(e) => update((d) => { d.currencies[idx].code = e.target.value.toUpperCase(); return d; })} /></td>
                <td><input value={c.name} style={{ width: 150 }} onChange={(e) => update((d) => { d.currencies[idx].name = e.target.value; return d; })} /></td>
                <td><input value={c.calendars.join(",")} style={{ width: 120 }} onChange={(e) => update((d) => { d.currencies[idx].calendars = e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean); return d; })} /></td>
                <td><input value={c.indices.join(",")} style={{ width: 150 }} onChange={(e) => update((d) => { d.currencies[idx].indices = e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean); return d; })} /></td>
                <td className="num"><input type="number" value={c.spotLag} style={{ width: 54 }} onChange={(e) => update((d) => { d.currencies[idx].spotLag = parseInt(e.target.value || "0", 10); return d; })} /></td>
                <td><button className="btn ghost danger" onClick={() => update((d) => { d.currencies.splice(idx, 1); return d; })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
