# CurveBuilder Web — Mantenedor de Curvas & Valorizador

SPA **React + TypeScript (Vite), 100% en el navegador**, con el estilo de la
suite (xva.cl / tradevol.cl). Es el front-end del motor de curvas: porta el
núcleo a TypeScript, así corre sin servidor y se despliega estático (GitHub
Pages) como un módulo par de la suite TradeAI.

El motor Python de `../` queda como **spec de referencia / golden tests**. Este
port reproduce sus números al dígito (par 5.1477 %, NPV 0, DV01 4.486.551 CLP
para el IRS CLP Cámara 5Y, CSA USD).

## Pestañas (el mantenedor)

1. **Inputs** — diccionario de tickers: mid/bid/ask, proveedor, descripción, shifters.
2. **Monedas** — alta de monedas: calendarios, índices flotantes, lag de spot.
3. **Curvas directas** — curvas nativas (se arman de tickers) y puentes; edita nodos y ve DF/tasa cero.
4. **Curvas heredadas** — crea curvas de 2 padres (nativas **o heredadas** → recursivo) + puente, con cutoff FX.
5. **Productos** — IRS/CCS (patas, índices, colaterales) + **router** (moneda, índice, CSA → estimación/descuento).
6. **Valorizador** — precia IRS/CCS (par, NPV, DV01) y exporta el **vector DF_ZC(t) para el motor XVA**.

Estado persistido en `localStorage` (Guardado local), con Exportar/Importar `.JSON` y Reset al caso base.

## Correr local

```bash
npm install
npm run dev      # http://localhost:5178
npm run build    # type-check + bundle estático en dist/
```

## Arquitectura

`src/engine/` es el port TS del motor (`dates, conventions, daycount, calendars,
feed, nodes, curves, router, pricing, model`). `model.buildSystem(config)` arma
el grafo ex-ante desde el estado editable (análogo a `config.py`). `src/state/`
tiene el store (contexto + persistencia) y el caso base (slice CLP). `src/tabs/`
son los mantenedores; `src/ui/` los helpers de formato/muestreo.

## Alcance y siguiente

Cubre tres complejos de curvas, todos construidos ex-ante y verificados:

- **CLP**: 490 USD_SOFR, 193 CLP_CAMARA, 194 basis → **423 CLP_COLL_USD**.
- **EUR**: 514 EUR_OIS_ESTR, 45 EUR_EURIBOR_6M, 92 basis EUR/USD → **403 EUR_COLL_USD**.
- **UF**: **520 CLF_VS_CAMARA** (`InflationForwardCurve`) — tramo corto de
  forwards de UF "día 9" y **tramo largo de swaps Cámara UF reales** (CHSWC),
  despejados como par swap real autodescontado (`solveRealSwapNode`,
  inflación = nominal − real) → **440 CLF_COLL_USD** (`InflationDiscountCurve`,
  DF_440 = DF_423 · UF_Fwd/UF_spot). Verificado: inflación 2Y 3.49%→20Y 2.86%,
  real 2Y 0.80%→20Y 2.29%, swap Cámara UF a par (residual ~1e-15).

Productos: IRS CLP/USD/EUR, CCS USD/CLP, CCS EUR/USD, IRS CLF Cámara, CCS CLF/CLP.
Verificado: IRS EUR par 2.8591 % (CSA USD) vs 2.8578 % (CSA EUR) — el router
cambia el descuento; 520 reproduce la inflación sembrada (~3.5 %) y 440 da el
real ≈ nominal − inflación.

**Solver CCS par (hecho):** el tramo largo de 423/403 resuelve el par del
cross-currency basis swap nodo a nodo (`InheritedCurve.solveBasisParNode`): el
CCBS de mercado valoriza a 0 (verificado, residual < 1e-15). Reemplaza la vieja
aproximación de basis como spread cero.

**CCS con intercambio de principal (hecho):** el pricer agrega el intercambio de
principal en los CCS (desde la óptica del receptor: −N al inicio, +N al
vencimiento, descontado colateralizado). Un CCS de basis de mercado valoriza a
~0 (verificado: USD/CLP 5Y con −55bps ≈ 0.4 bp del nocional; sin el spread
refleja el valor completo del basis). Antes daba magnitudes sin sentido.

**Simplificaciones (documentadas, siguiente hito):** el monitor breakeven
18M-2Y de UF (brokers vs swap) y el devengo diario exacto de la UF (día 10 a
día 9) quedan pendientes; los residuales sub-bp del CCS cierran con convenciones
de schedule plenamente alineadas y datos reales. El núcleo Python valida el slice
CLP (incl. solver CCS par); EUR/UF y el pricing CCS viven en esta app web.
