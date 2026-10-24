# Monitor Vecinal — Sendero Río del Hato

Aplicación web **100% en español**, **100% anónima** y lista para publicar gratis en **GitHub Pages**. Muestra un mapa del sector con los incidentes reportados por los vecinos y los días transcurridos desde el último. Los incidentes viven en `data/incidents.json`, una base de datos abierta estilo Wikipedia.

## Características

1. **Contador `DÍAS DESDE EL ÚLTIMO INCIDENTE`** con el resumen del último reporte y los píxeles en alerta.
2. **Mapa del sector** (~2.8 × 2.9 km, Piedecuesta) dibujado a partir de datos de OpenStreetMap: calles por jerarquía, ríos, senderos, nombres de vías, lugares, autos y peatones animados.
3. **Mapa de calor** sobre una grilla de 200 × 200 tiles (~14 m cada uno): cada incidente tiñe los tiles vecinos según gravedad (1 a 5) y antigüedad. Rojo = seguridad, amarillo = ruido/convivencia.
4. **Edición abierta estilo Wikipedia** de incidentes: reportar, editar, confirmar, mover y revertir desde el historial.
5. Pensado para **celular**: hoja inferior única, botones táctiles de 44 px, pellizco para zoom.

## Uso local

```bash
npm run dev
```

Abre `http://localhost:5173` (en el celular: `http://<IP-de-tu-computador>:5173`, misma red Wi-Fi). En local, cada cambio hecho desde la interfaz se guarda en `data/incidents.json`.

> ⚠️ Mientras no cambies la configuración del puente, **guardar un reporte también hace un commit en GitHub** a través del Worker de Cloudflare. Para probar sin publicar, ejecuta una vez en la consola del navegador y recarga:
>
> ```js
> localStorage.setItem('vecinos_rio_hato_github_bridge_v1', JSON.stringify({bridgeUrl:'', githubRepo:'xthecapx/days'}))
> ```

## Cómo se organiza el mapa

El mapa tiene **tres capas de datos** y todas usan coordenadas reales (lat/lng):

| Archivo | Qué contiene | Quién lo edita |
|---|---|---|
| `data/map.json` | Calles, ríos, senderos y zonas descargados de OpenStreetMap | Se genera con `npm run map:update`. No lo edites a mano. |
| `data/map-overrides.json` | Tus ajustes: HOGAR, lugares, sectores, clases de vía, vías extra u ocultas | **Tú**, a mano. Nunca se sobrescribe. |
| `data/incidents.json` | Incidentes y su historial de revisiones | La app (y tú, para correcciones). |

Los incidentes se guardan con `lat`/`lng`. El tile `(pixelX, pixelY)` se recalcula en cada carga, así que **cambiar el área o el tamaño de la grilla nunca mueve un incidente**.

## Actualizar el mapa

### Traer datos nuevos de OpenStreetMap

```bash
npm run map:update
```

Descarga el área definida en `src/core/geo.js` y reescribe `data/map.json`. Si el servidor público (Overpass) está saturado, el script reintenta con otros servidores; si falla del todo, espera unos minutos y repite. Después recarga la app y haz `git add data/map.json`.

### Cambiar o ampliar el área

1. Edita `GEO_BOUNDS` (`south`, `north`, `west`, `east`) y, si hace falta, `GRID_WIDTH`/`GRID_HEIGHT` en `src/core/geo.js`. Es el único lugar: el mapa, el script y el Worker que valida los reportes lo leen de ahí.
2. Mantén tiles de ~14 m (área en metros ÷ 14).
3. Ejecuta `npm run map:update`.
4. Si cambiaste el Worker o los límites, se vuelve a desplegar solo al hacer push a `main`.

Los incidentes se reubican solos. Áreas mucho mayores (toda una ciudad) necesitan otra arquitectura: el mapa se dibuja en un solo lienzo y los datos viven en un solo archivo.

### Corregir lo que OpenStreetMap no tiene o tiene mal

Todo se hace en `data/map-overrides.json` (se conserva al actualizar):

- **`home`**: `{ "lat", "lng", "label" }` — la casa que se marca en el mapa.
- **`places`**: lugares con ícono (`kind: "poi"`) o solo texto (`kind: "area"`). `lod` decide desde qué zoom se ven: `1` siempre, `2` zoom ≥ 1.4, `3` zoom ≥ 2.2.
- **`sectors`**: nombres de zona por radio: `{ "name", "lat", "lng", "radiusM" }`. Se usan al reportar y en la barra inferior.
- **`roadClass`**: cambia la clase de una calle por nombre, p. ej. `{ "Avenida Calle 13 Norte": "arterial" }`. Clases: `highway`, `collector`, `arterial`, `minor`, `local`, `busway`, `trail`, `dirt`.
- **`rename`**: corrige nombres, p. ej. `{ "Río Lato del Hato": "Río del Hato" }`.
- **`hideWays`**: ids (u nombres) de vías de OSM que no quieres ver.
- **`extraRoads`**: vías que faltan: `{ "cls", "name", "pts": [[lat,lng], …] }`.
- **`areas`**: zonas extra (p. ej. suelo abierto): `{ "kind", "pts": [[lat,lng], …] }`.

Para sacar lat/lng de un punto: clic derecho en Google Maps o en openstreetmap.org → copiar coordenadas.

Si algo está mal en OpenStreetMap mismo (una calle que falta para todos), también puedes corregirlo allí en [openstreetmap.org](https://www.openstreetmap.org) y volver a correr `npm run map:update`.

### Estilo de las vías

Colores, anchos y cuándo se ocultan al alejar el mapa están en `src/map/data/roadStyles.js`.

### Qué no trae OpenStreetMap aquí

No hay edificios en esta zona: las casas del mapa son decoración generada por el código (`src/map/render/baseMap.js`).

## Estructura del código

```
index.html             Estructura de la pantalla
data/                  map.json · map-overrides.json · incidents.json
scripts/update-map.mjs Descarga de OpenStreetMap
src/main.js            Conecta todas las piezas
src/state/             Store con suscripciones, acciones y selectores
src/core/geo.js        Área del mapa y tamaño de la grilla (única definición)
src/domain/            Reglas puras de incidentes e historial (sin DOM ni red)
src/services/          Casos de uso (incidentes) y servicios del teléfono (gps.js, whatsapp.js)
src/storage/           Adaptadores: repositorio, copia del navegador, disco local y puente (PR)
src/map/               Cámara, grilla, modelo del mapa (`buildWorld`, `createSectorNamer`), mapa de calor
src/map/render/        Una capa de dibujo por archivo (base, calor y sus colores, etiquetas, marcadores…)
src/ui/                HUD (hud, alertCard, peek, whatsappMenu, insets), hoja inferior y gestos del mapa
src/ui/panes/          Un panel de la hoja por archivo: incidents, history, settings, report
src/styles/            base.css · hud.css · sheets.css
```

## Publicar gratis en GitHub Pages

1. Sube este repositorio a GitHub.
2. En **Settings → Pages → Build and deployment** elige **GitHub Actions** (el flujo `.github/workflows/deploy-pages.yml` ya está incluido) o **Deploy from a branch** con `main` (`/ (root)`).
3. *(Opcional, para que los vecinos editen sin cuenta de GitHub)*: despliega `worker/github-wiki-bridge.js` en Cloudflare Workers con un token restringido a `data/incidents.json`, y define la variable `GITHUB_TOKEN`.

## Créditos y licencia de datos

Datos del mapa © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), disponibles bajo la licencia [ODbL](https://opendatacommons.org/licenses/odbl/). Si publicas el mapa, mantén esta atribución visible.
