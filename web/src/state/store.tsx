import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AppConfig, buildSystem, CurveSystem } from "../engine/model";
import { cloneDefault } from "./defaults";

const LS_KEY = "curvebuilder.config.v3";

interface Store {
  config: AppConfig;
  system: CurveSystem;
  update: (fn: (draft: AppConfig) => AppConfig) => void;
  replace: (cfg: AppConfig) => void;
  reset: () => void;
  exportJson: () => void;
  importJson: (text: string) => string | null; // devuelve error o null
}

const Ctx = createContext<Store | null>(null);

function load(): AppConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as AppConfig;
  } catch { /* ignore */ }
  return cloneDefault();
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(load);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(config)); } catch { /* ignore */ }
  }, [config]);

  const system = useMemo(() => {
    try { return buildSystem(config); }
    catch (e) {
      return { valDate: new Date(), feed: null as any, registry: {}, router: null as any, swapManager: null as any, errors: [(e as Error).message] } as CurveSystem;
    }
  }, [config]);

  const store: Store = {
    config,
    system,
    update: (fn) => setConfig((c) => fn(structuredClone(c))),
    replace: (cfg) => setConfig(cfg),
    reset: () => setConfig(cloneDefault()),
    exportJson: () => {
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `curvebuilder_${config.valuationDate}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    importJson: (text) => {
      try {
        const parsed = JSON.parse(text) as AppConfig;
        if (!parsed.curves || !parsed.inputs) return "JSON sin 'curves'/'inputs'.";
        setConfig(parsed);
        return null;
      } catch (e) { return (e as Error).message; }
    },
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore fuera de StoreProvider");
  return s;
}
