import { useEffect, useRef, useState } from "react";
import { StoreProvider, useStore } from "./state/store";
import { InputsTab } from "./tabs/InputsTab";
import { CurrenciesTab } from "./tabs/CurrenciesTab";
import { NativeCurvesTab } from "./tabs/NativeCurvesTab";
import { InheritedCurvesTab } from "./tabs/InheritedCurvesTab";
import { ProductsTab } from "./tabs/ProductsTab";
import { ValuationTab } from "./tabs/ValuationTab";

const TABS = [
  { id: "inputs", label: "Inputs", el: <InputsTab /> },
  { id: "monedas", label: "Monedas", el: <CurrenciesTab /> },
  { id: "directas", label: "Curvas directas", el: <NativeCurvesTab /> },
  { id: "heredadas", label: "Curvas heredadas", el: <InheritedCurvesTab /> },
  { id: "productos", label: "Productos", el: <ProductsTab /> },
  { id: "valorizador", label: "Valorizador", el: <ValuationTab /> },
];

function Toolbar() {
  const { exportJson, importJson, reset, system } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const built = Object.keys(system.registry).length;

  return (
    <div className="panel-head" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <span className="badge live">{built} curvas</span>
      <span className="hint">Guardado local automatico</span>
      <span className="spacer" />
      <div className="btn-row">
        <button className="btn ghost" onClick={exportJson}>Exportar .JSON</button>
        <button className="btn ghost" onClick={() => fileRef.current?.click()}>Importar .JSON</button>
        <button className="btn danger" onClick={() => { if (confirm("Reset al caso base?")) reset(); }}>Reset</button>
      </div>
      <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          const err = importJson(await f.text());
          setMsg(err ? `Error: ${err}` : "Importado OK");
          setTimeout(() => setMsg(null), 3000);
          e.target.value = "";
        }} />
      {msg && <span className="hint" style={{ color: "var(--warn)" }}>{msg}</span>}
    </div>
  );
}

const TAB_IDS = TABS.map((t) => t.id);

function tabFromHash(): string {
  const h = location.hash.replace(/^#/, "").toLowerCase();
  return TAB_IDS.includes(h) ? h : "inputs";
}

function Shell() {
  const [active, setActive] = useState(tabFromHash);
  const { system } = useStore();
  const current = TABS.find((t) => t.id === active) ?? TABS[0];

  useEffect(() => {
    const onHash = () => setActive(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = (id: string) => {
    setActive(id);
    if (location.hash.replace(/^#/, "") !== id) history.replaceState(null, "", `#${id}`);
  };

  return (
    <>
      <div className="ribbon">
        <a href="https://segundaopinion.cl" target="_blank" rel="noreferrer">SegundaOpinión ↗</a>
        <span className="sep">|</span>
        <a href="https://tradeai.cl" target="_blank" rel="noreferrer">Suite TradeAI ↗</a>
        <span className="sep">|</span>
        <a href="https://xva.cl" target="_blank" rel="noreferrer">XVA ↗</a>
        <span className="sep">|</span>
        <span className="here">CurveBuilder</span>
        <span className="spacer" />
        <span>Quant Desk Chile</span>
      </div>

      <div className="header">
        <h1>Curve<span className="accent">Builder</span> · Mantenedor &amp; Valorizador</h1>
        <div className="sub">
          Inputs · Monedas · Curvas directas/heredadas · Productos · Valorizador IRS/CCS · feed XVA — 100% navegador
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t, i) => (
          <button key={t.id} className={`tab ${active === t.id ? "active" : ""}`} onClick={() => select(t.id)}>
            <span className="num">{i + 1}</span>{t.label}
          </button>
        ))}
      </div>

      <div className="main">
        <div className="panel"><Toolbar /></div>
        {system.errors.length > 0 && (
          <div className="notice" style={{ marginBottom: 16 }}>
            <b>Avisos del grafo:</b>
            {system.errors.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}
        {current.el}
      </div>
    </>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
