# curve-engine

Motor de construcción de curvas de mercado **estilo Bloomberg (ICVS / SWPM)** para
valorización multi-curva (dual-curve: proyección vs. descuento) e integración con
XVA. Implementa la arquitectura descrita en el *Manual de Construcción de Curvas
Estilo Bloomberg*: 4 capas desacopladas, curvas nativas y heredadas (patrón
Composite recursivo) y un enrutador de curvas por pata según el CSA.

Local-first. La capa web/API queda preparada para una **segunda etapa** (ver
`Roadmap`), pero el núcleo es un paquete Python puro, sin dependencias de runtime.

---

## Alcance actual — Slice CLP (primer hito)

Complejo de curvas para valorizar el **IRS CLP Cámara** bajo el estándar
interbancario (CSA TH=0, Cash USD), que es el ejemplo de "las 5 curvas" del manual:

```
490 USD_SOFR  (Nativa)  ─┐
193 CLP_CAMARA (Nativa) ─┼─► 423 CLP_COLL_USD (Heredada)  ← curva de descuento
194 BASIS_USD_CLP (puente)┘       (FX fwd ≤18M + CCS basis ≥2Y)
```

- **490** USD SOFR: cash O/N + OIS anual, bootstrapping recursivo.
- **193** CLP Cámara (CLICP): cash TPM + cero cupón ≤18M + swaps semestrales ≥2Y.
- **194** puente basis USD/CLP: puntos FX NDF (≤18M) + CCS basis (≥2Y).
- **423** CLP colateralizada en USD: heredada de 490 + 193 + 194.
- Ruteo por pata + `SwapManager` que valoriza el IRS y entrega **tasa par, NPV y DV01**.

### Qué es exacto y qué es aproximado (honestidad de modelo)

| Pieza | Estado |
|---|---|
| Bootstrapping OIS/cero/cupón de curvas nativas | Correcto (par-swap autodescontado) |
| CIP tramo corto de la 423 (DF = DF_SOFR · S₀/F) | Exacto dado el input |
| Tramo largo de la 423 (**solver CCS par** nodo a nodo) | Exacto: el CCBS de mercado valoriza a 0 (test `test_ccs_basis_par_zero_mtm`, residual < 1e-9) |
| Calendarios / feriados | Semilla 2026–2029 (fijos + movibles conocidos). Completar para clavar al día vs SWPM |
| Datos de mercado `data/market_2026_11_07.json` | **Semilla coherente**, NO las capturas exactas de pantalla. Spots sí son del manual |

> Para validar *Zero-MtM al centavo* contra SWPM hay que reemplazar los `quotes`
> por los pilares exactos de las capturas y completar los feriados del horizonte.

---

## Instalación y uso

Requiere Python ≥ 3.11 (probado en 3.12). El núcleo no tiene dependencias;
`pytest` solo para tests.

```bash
# (opcional) entorno virtual
python -m venv .venv && .venv\Scripts\activate   # Windows

# correr la demo sin instalar nada
python scripts/run_slice.py

# o instalar en editable y usar el comando de consola
pip install -e ".[dev]"
curve-slice
pytest -q
```

La demo construye el grafo de curvas, imprime las tablas de DF / tasa cero de
490, 193 y 423, y valoriza un IRS CLP Cámara 5Y a tasa par (NPV ≈ 0),
fuera de mercado (NPV + DV01) y cambiando el colateral (USD vs CLP).

---

## Arquitectura (4 capas desacopladas)

```
feed.MarketFeedManager   Capa 1  Ingesta multi-proveedor + override manual + LKG fallback
nodes.MarketNode         Capa 2  Reglas microestructurales por ticker (base, freq, cal, lags, shifter)
curves.BaseCurve         Capa 3  Objeto Curva polimórfico:
   ├─ NativeCurve                 - se construye desde tickers (bootstrapping)
   └─ InheritedCurve              - se construye desde 2 curvas padre + nodos puente
router.LegCurveRouter    Capa 4  Asigna (estimación, descuento) por (moneda, índice, CSA)
builder.CurveGraphBuilder        Construye el grafo ex-ante en orden topológico (DAG)
pricing.SwapManager              Valoriza tickets vanilla usando el ruteo
config.load_curve_system         Arma todo desde JSON (sin nada "en duro")
```

**Todo es configuración.** Agregar una curva o una regla de ruteo es editar
`data/curves_master_config.json`; cambiar precios es editar el snapshot de
mercado. El código no se toca.

### Estructura

```
curve-engine/
├─ src/curve_engine/        # paquete
│  ├─ conventions.py  daycount.py  calendars.py
│  ├─ feed.py  nodes.py  curves.py  builder.py  router.py  pricing.py
│  ├─ config.py            # loader JSON -> sistema de curvas
│  └─ scripts_entry.py     # demo del slice
├─ data/
│  ├─ curves_master_config.json   # definición de curvas + ruteo
│  └─ market_2026_11_07.json      # snapshot de mercado (semilla)
├─ scripts/run_slice.py
└─ tests/                  # 21 tests (daycount, calendars, curves, pricing, router)
```

---

## Roadmap

1. ~~Solver par del CCS~~ ✔ hecho — el tramo largo de 423/403 resuelve el par
   del cross-currency basis swap (`_solve_basis_par_node`); el CCBS valoriza a 0.
2. **Short-end anclado a RPM** (flat-forward en fechas de reunión del BCCh) en la 193.
3. **Curvas restantes del universo**: 521, 520/440 (UF con motor de "días 9"),
   514/45/92/403 (EUR), y productos CCS multi-moneda.
4. **Interpolación Monotone Cubic Spline** opcional en el tramo largo.
5. **Etapa 2 — API web**: envolver `config` + `SwapManager` en FastAPI
   (`pip install ".[api]"`) con contrato JSON para ingestar cualquier dato externo
   que respete el formato, y una UI (Streamlit/React) encima del mismo núcleo.

El núcleo ya está desacoplado para que la API no reimplemente nada: solo exponga
`load_curve_system`, el feed y el `SwapManager`.
