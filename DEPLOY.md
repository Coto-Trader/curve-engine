# Deploy — CurveBuilder (GitHub Pages)

La SPA vive en `web/` y se publica con GitHub Actions (`.github/workflows/deploy.yml`):
build de `web/` → `web/dist` → GitHub Pages. El `base` de Vite es relativo
(`"./"`), así que el sitio funciona tanto en la URL de proyecto
(`coto-trader.github.io/curve-engine/`) como, más adelante, en un path bajo
`tradeswap.cl/…`.

## 1. Crear el repo y publicar (lo corres tú)

`gh` ya está autenticado como `Coto-Trader`. Desde `C:\Users\carlo\Proyectos\curve-engine`:

```bash
gh repo create Coto-Trader/curve-engine --public --source=. --remote=origin --push
```

## 2. Habilitar Pages (una vez)

En GitHub: repo **curve-engine → Settings → Pages → Build and deployment →
Source: "GitHub Actions"**. (O por CLI: `gh api --method POST repos/Coto-Trader/curve-engine/pages -f build_type=workflow`.)

Luego, en la pestaña **Actions**, re-ejecuta el workflow "Deploy CurveBuilder (web)"
si la primera corrida falló por Pages aún no habilitado.

## 3. Verificar

Queda live en: **https://coto-trader.github.io/curve-engine/**

```bash
curl -I https://coto-trader.github.io/curve-engine/
```

## 4. (Siguiente) Integración en tradeswap.cl

Objetivo: servir el mantenedor/valorizador bajo `tradeswap.cl/curvas` (o
`/buildcurve`) y conectar el valorizador directo a TradeSwap. Opciones:

- **Path en el repo `tradeswap-cl`**: copiar el build de `web/dist` a
  `tradeswap-cl/curvas/` (base `./` ya lo permite) y que Pages de tradeswap.cl lo
  sirva en esa ruta. Simple, un solo dominio.
- **Subdominio** `curves.tradeswap.cl` → apuntando a este Pages (CNAME Cloudflare).
- **Cloudflare Worker** enrutando `tradeswap.cl/curvas/*` a este sitio.

Recomendado: el path en `tradeswap-cl` (mismo dominio, sin DNS nuevo).

### Sync automático (ya configurado)

`tradeswap-cl` tiene un workflow **`.github/workflows/sync-curvas.yml`** que hace
checkout de este repo (`curve-engine`, público), compila `web/` y actualiza
`tradeswap-cl/curvas/` por sí solo (commit con el `GITHUB_TOKEN`, sin PAT). Se
dispara manual o diario (09:00 UTC):

```bash
# forzar el sync ahora (tras cambiar la SPA en curve-engine)
gh workflow run sync-curvas.yml -R Coto-Trader/tradeswap-cl
```

Así, `coto-trader.github.io/curve-engine/` (standalone) y `tradeswap.cl/curvas/`
se mantienen al día desde la misma fuente. Para sync inmediato en cada push a
`curve-engine` haría falta un PAT con `contents:write` sobre `tradeswap-cl` y un
paso `repository_dispatch` en el deploy de curve-engine (opcional).
