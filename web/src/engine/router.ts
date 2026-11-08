import { BaseCurve } from "./curves";

export interface LegCurveAssignment {
  forecastCurve: BaseCurve | null;
  discountCurve: BaseCurve;
}

export interface RoutingRule {
  legCcy: string;
  legIndex: string;
  csa: string;
  forecast: string | null;
  discount: string;
}

function keyOf(ccy: string, index: string, csa: string): string {
  return `${ccy.toUpperCase()}|${index.toUpperCase()}|${csa.toUpperCase()}`;
}

/** Mantenedor de monedas / asignador de curvas por pata (Capa 4). */
export class LegCurveRouter {
  registry: Record<string, BaseCurve>;
  private rules = new Map<string, [string | null, string]>();

  constructor(registry: Record<string, BaseCurve>) {
    this.registry = registry;
  }

  registerRule(r: RoutingRule): void {
    this.rules.set(keyOf(r.legCcy, r.legIndex, r.csa), [r.forecast, r.discount]);
  }

  resolve(legCcy: string, legIndex: string, csa: string): LegCurveAssignment {
    const k = keyOf(legCcy, legIndex, csa);
    const hit = this.rules.get(k);
    if (!hit) throw new Error(`No hay regla de ruteo para ${k}`);
    const [fId, dId] = hit;
    const disc = this.registry[dId];
    if (!disc) throw new Error(`Curva de descuento ${dId} no existe en el registro.`);
    return {
      forecastCurve: fId ? this.registry[fId] ?? null : null,
      discountCurve: disc,
    };
  }

  hasRule(legCcy: string, legIndex: string, csa: string): boolean {
    return this.rules.has(keyOf(legCcy, legIndex, csa));
  }
}
