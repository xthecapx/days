# Monitor Vecinal — Sendero Río del Hato

Aplicación web **100% en español**, **100% anónima** y lista para publicar gratis en **GitHub Pages**. Muestra un mapa del sector con los incidentes reportados por los vecinos y los días transcurridos desde el último. Los incidentes viven en `data/incidents.json`, una base de datos abierta: cada reporte llega como un Pull Request y solo se publica cuando el dueño lo aprueba.

## Características

1. **Contador `DÍAS DESDE EL ÚLTIMO INCIDENTE`** con el resumen del último reporte y los píxeles en alerta.
2. **Mapa del sector** (~2.8 × 2.9 km, Piedecuesta) dibujado a partir de datos de OpenStreetMap: calles por jerarquía, ríos, senderos, nombres de vías, lugares, autos y peatones animados.
3. **Mapa de calor** sobre una grilla de 200 × 200 tiles (~14 m cada uno): cada incidente tiñe los tiles vecinos según gravedad (1 a 5) y antigüedad. Rojo = seguridad, amarillo = ruido/convivencia.
4. **Reportes abiertos y moderados** de incidentes: reportar, editar, confirmar y mover desde la propia app. El historial de cambios es el de git (un Pull Request por reporte).
5. Pensado para **celular**: hoja inferior única, botones táctiles de 44 px, pellizco para zoom.
6. **Señal de ayuda entre vecinos** (🆘): una persona avisa con un toque y quien tenga la escucha activa ve el punto en el mapa. Ver [Señal de ayuda](#señal-de-ayuda).

## Uso local

Necesitas Node 20.19+ o 22.12+ (hay un `.nvmrc`).

```bash
npm install     # una sola vez
npm run dev     # servidor de desarrollo (Vite) en http://localhost:5173
```

Abre `http://localhost:5173`. En `localhost` cada cambio hecho desde la interfaz se guarda directo en `data/incidents.json` y **no** se envía al puente. En el celular usa `http://<IP-de-tu-computador>:5173` (misma red Wi-Fi), pero ojo: con una IP la app se comporta como en producción y **guardar un reporte abre un Pull Request** a través del Worker de Cloudflare. Para probar desde el celular sin publicar, ejecuta una vez en la consola del navegador y recarga:
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
| `data/incidents.json` | Incidentes | La app (y tú, para correcciones). |

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
vite.config.js        Vite: servidor de desarrollo, empaquetado y copia de data/
services/signal/       Servidor de la señal de ayuda (Cloudflare Worker + Durable Object), independiente de la interfaz
worker/                Puente (Cloudflare Worker) que abre un PR por cada reporte
tests/                 Pruebas con node:test (lógica) y tests/e2e (navegador real)
public/                Archivos que se copian tal cual al sitio (favicon)
src/main.js            Conecta todas las piezas
src/state/             Store con suscripciones, acciones y selectores
src/core/geo.js        Área del mapa y tamaño de la grilla (única definición)
src/core/clock.js      "Hoy" de la app: sigue al reloj del dispositivo
src/domain/            Reglas puras de incidentes (sin DOM ni red)
src/services/          Casos de uso (incidentes), señal de ayuda (signalApi/Feed/Service) y servicios del teléfono (gps.js, whatsapp.js)
src/storage/           Adaptadores: repositorio, copia del navegador, disco local y puente (PR)
src/map/               Cámara, grilla, modelo del mapa (`buildWorld`, `createSectorNamer`), mapa de calor
src/map/render/        Una capa de dibujo por archivo (base, calor y sus colores, etiquetas, marcadores…)
src/ui/                HUD (hud, alertCard, peek, whatsappMenu, syncToast, insets), hoja inferior y gestos del mapa
src/ui/panes/          Un panel de la hoja por archivo: incidents, settings, report
src/styles/            base.css · hud.css · sheets.css
```

## Publicar gratis en GitHub Pages

1. Sube este repositorio a GitHub.
2. En **Settings → Pages → Build and deployment** elige **GitHub Actions**. El flujo `.github/workflows/deploy-pages.yml` ejecuta `npm ci && npm run build` y publica solo `dist/`: `index.html`, un `.js` y un `.css` empaquetados por Vite (con hash en el nombre, así un despliegue nuevo nunca se mezcla con archivos viejos en caché) y `data/` copiada tal cual. El Worker, los scripts y las pruebas no se publican. Para ver ese mismo resultado en local: `npm run build && npm run preview`.
3. *(Opcional, para que los vecinos editen sin cuenta de GitHub)*: despliega `worker/github-wiki-bridge.js` en Cloudflare Workers con un token restringido a `data/incidents.json`, y define la variable `GITHUB_TOKEN`.

> Con **Deploy from a branch** también funciona, pero publica todo el repositorio tal cual.

## Señal de ayuda

Un aviso de «necesito ayuda aquí» entre vecinos. **No reemplaza al 123**: la propia pantalla lo recuerda. Es una prueba de concepto.

**Cómo funciona**

1. Alguien pulsa 🆘 en la app, o usa un atajo del teléfono (ver [Atajos](#atajos-del-teléfono)). Se envía solo su posición.
2. Al abrir o recargar la página, la app lee **una vez** el servidor: si hay una alerta activa, aparece un aviso rojo y un 🆘 que late en el mapa.
3. Quien activa **«Avisarme cuando alguien pida ayuda»** (hoja 🆘) pregunta al servidor **cada 30 s**, y **solo mientras la pantalla está a la vista**. Con la pestaña oculta o el teléfono bloqueado no se pregunta nada: no hay notificaciones push ni nada en segundo plano.
4. La cifra verde sobre el botón 🆘 es cuántos vecinos tienen la escucha activa ahora (visible para todos). Cada oyente cuenta hasta 75 s después de su última consulta.

**Qué se guarda (y qué no)**

- De cada alerta solo se guarda la **casilla del mapa (~14 m)**, la hora y un identificador aleatorio. Nunca las coordenadas exactas, la precisión, un nombre ni texto libre.
- La IP no se guarda: se convierte en un hash con un secreto del servidor (`SIGNAL_PEPPER`) solo para limitar el ritmo y permitir una alerta por persona. No sale en ninguna respuesta.
- Una alerta dura **30 minutos** y desaparece. Quien la envió desde la app puede retirarla antes; el permiso para hacerlo (un token) solo vive en su navegador.
- No hay cuentas ni usuarios. Cualquiera con la dirección puede enviar o leer: es un riesgo aceptado en esta prueba (ver [Límites](#límites-conocidos)).

**Servidor** (`services/signal/`, Cloudflare Worker + Durable Object con SQLite). URL: `https://days-signal.xthecapx.workers.dev/`

| Método y ruta | Qué hace |
|---|---|
| `GET /` | Estado del servicio (¿hay secreto configurado?). No lleva datos. |
| `GET /state` | Alertas activas y cuántos escuchan. Público, **no** te cuenta como oyente. |
| `POST /poll` `{listener, listening}` | Igual que `/state`, y te cuenta (o te saca) como oyente. |
| `POST /signal` `{lat, lng}` | Crea tu alerta (reemplaza la anterior de la misma conexión). Devuelve el token para retirarla. |
| `POST /signal/cancel` `{id, token}` | Retira una alerta con su token. |

**Todo es real: no hay salas ni modo de pruebas.** Lo que se envía lo ve cualquiera que abra la app. (Los enlaces o atajos antiguos con `?room=…` siguen funcionando: el parámetro se ignora.) Las coordenadas pueden llegar como número o como texto, incluso con coma decimal (`"7,005"`), y el cuerpo puede ser JSON o un formulario: así lo envían los Atajos de iPhone.

**Límites del servidor:** solo dentro del área del mapa · 6 alertas/min y 30 consultas/min por conexión (aprox.) · una alerta por persona · máximo 20 alertas y 1000 oyentes · cuerpos de hasta 2 KB · solo `https://xthecapx.github.io` puede llamar desde un navegador (los atajos del teléfono no mandan `Origin`).

**Desarrollo local**

```bash
npm run signal:dev   # servidor local en http://localhost:8787 (acepta localhost y la red local)
npm run dev          # la app, apuntando a ese servidor local
```

`vite dev` usa ese servidor local porque el publicado solo acepta llamadas desde `https://xthecapx.github.io` (CORS). **El servidor local tiene su propia memoria: lo que envíes ahí no llega a la app publicada.** Una copia construida (`npm run preview`) servida desde tu computador **no** puede hablar con el servidor publicado (el navegador la bloquea por CORS), así que ahí la señal de ayuda aparece como «sin conexión»: para probar la señal de punta a punta usa el sitio publicado o `npm run dev` con `npm run signal:dev`.

### Atajos del teléfono

Para pedir ayuda sin abrir la app. **Hay que crearlos una vez en cada teléfono.**

**Todo es real.** Un atajo envía una alerta de verdad: aparece en la app publicada durante 30 minutos y la ve cualquiera que la abra. Avisa a quienes te rodean antes de probar, o prueba tú con dos teléfonos.

**iPhone (app Atajos)** — una acción «Obtener ubicación actual» y una «Obtener contenido de URL»:

1. Atajos → **+** → nombre «Pedir ayuda».
2. **Obtener ubicación actual**.
3. **Obtener contenido de URL**:
   - URL: `https://days-signal.xthecapx.workers.dev/signal`
   - *Mostrar más* → Método **POST** → Cuerpo de la solicitud **Formulario** (o JSON).
   - Dos campos de **Texto**: `lat` = *Ubicación actual* → **Latitud**, y `lng` = *Ubicación actual* → **Longitud**.
4. **Mostrar notificación** con el resultado, para saber que salió.
5. Ponle un acceso: *Ajustes → Botón de acción*, *Tocar atrás*, un widget de Pantalla de inicio / Pantalla bloqueada, o decir «Oye Siri, pedir ayuda».

**Android** — la app gratuita [HTTP Shortcuts](https://http-shortcuts.rmy.ch/): un atajo con método POST a la misma URL (`…/signal`) y un cuerpo con `lat` y `lng`; se agrega como widget a la pantalla de inicio. *No he podido comprobar si permite insertar la ubicación actual en el cuerpo*; si no lo permite, usa el icono de la app (siguiente punto).

**Icono en la pantalla de inicio (iPhone y Android):** abre la app en `https://xthecapx.github.io/days/?sos=1` → *Compartir → Añadir a pantalla de inicio*. Al abrirlo cae directo en la pantalla de ayuda, ya con el botón de confirmar. En Android (Chrome) el icono instalado también ofrece «Pedir ayuda» al mantenerlo pulsado.

**Traccar Client y OwnTracks: no sirven aquí.** Son rastreadores continuos que envían tu posición en segundo plano y se identifican con un id de dispositivo: lo contrario de una señal puntual y anónima. Tampoco encontré en Traccar Client un botón de «enviar ahora».

### Límites conocidos

- **Cualquiera con la dirección puede enviar una alerta falsa**: no hay cuentas ni claves. Lo frenan el área del mapa, el límite de ritmo, una alerta por persona y los 30 minutos de vida; no lo impiden. Si esto llega a usuarios reales, el siguiente paso es una clave en el atajo o un rol.
- **Quien abre la app ve las alertas activas** (a ~14 m), aunque no esté escuchando.
- **Con la pantalla bloqueada o la pestaña oculta no se recibe nada.** No hay notificaciones push.
- **Una alerta enviada desde un atajo no se puede retirar desde la app** (el token se queda en el atajo); vence sola a los 30 min o se reemplaza enviando otra.
- **Si se agota el plan gratuito de Cloudflare**, la señal deja de responder hasta las 00:00 UTC; la app lo muestra y recuerda llamar al 123 o usar WhatsApp.
- La cifra de oyentes es aproximada y se puede falsear.

## Dos despliegues independientes

| Qué | Dónde | Se publica cuando cambia… | Flujo |
|---|---|---|---|
| Interfaz (mapa, reportes) | GitHub Pages | `src/`, `index.html`, `public/`, **`data/`**, `vite.config.js`, dependencias | `deploy-pages.yml` |
| Servidor de la señal de ayuda | Cloudflare Worker (`days-signal`) | `services/signal/` y los límites del mapa que comparte (`src/core/geo.js`, `src/map/gpsGrid.js`) | Cloudflare Workers Builds (conexión a GitHub en el panel; ver abajo) |
| Puente de reportes (abre el Pull Request) | Cloudflare Worker (`days`) | `worker/` | Cloudflare Workers Builds |

**Conectar el servidor de la señal (una sola vez, en el panel de Cloudflare):** Workers & Pages → *Create application* → importar este repositorio, con estos valores:

- Nombre del Worker: `days-signal` (el mismo de `services/signal/wrangler.jsonc`).
- *Root directory*: `services/signal`.
- *Deploy command*: el de siempre (`npx wrangler deploy`).
- *Build watch paths* (incluir): `services/signal/*`, `src/core/geo.js`, `src/map/gpsGrid.js`. Así los cambios de la interfaz no vuelven a construirlo.
- El secreto `SIGNAL_PEPPER` se crea en el Worker, en *Settings → Variables and Secrets*, como **Secret** (las *Build variables* no llegan al Worker en ejecución).

Las pruebas del servidor corren en cada PR con el resto (`test.yml`); Cloudflare solo construye lo que ya está en `main`.

`data/` está en la lista de la interfaz a propósito: un reporte aprobado cambia `data/incidents.json` y tiene que publicarse (`tests/workflows.test.js` lo comprueba). Las pruebas (`test.yml`) corren siempre. `.npmrc` fija el registro público de npm: sin eso, un registro privado en tu configuración personal se cuela en `package-lock.json` y GitHub Actions no puede instalar (hay una prueba que lo vigila).

## Seguridad

- El sitio publicado lleva una **política de seguridad de contenido** (`<meta http-equiv="Content-Security-Policy">`, definida en `vite.config.js`): solo scripts y estilos propios, y las únicas salidas son Google Fonts, GitHub (lectura de `incidents.json`) y el Worker. Si agregas otro servicio externo, añádelo ahí o el navegador lo bloqueará.
- El formulario de reporte **no propone fecha ni hora**: la persona elige «Hoy», «Ayer» u «Otro día», así el día en que se reporta nunca se guarda como el día en que ocurrió (eso es lo que cuenta «días desde el último incidente»). El color del mapa sale de la categoría, y el botón de guardar se bloquea mientras guarda para no abrir dos Pull Requests.
- La señal de ayuda va a un servidor aparte (`services/signal`); el flujo de reportes no la usa ni la conoce. Detalles, límites y privacidad en [Señal de ayuda](#señal-de-ayuda).
- Todo texto de los vecinos se escapa antes de pintarse, y los números que llegan de `incidents.json` se convierten con `toNumber`.
- En desarrollo, el endpoint que escribe `data/incidents.json` solo acepta peticiones desde este mismo computador (aunque el servidor esté abierto a la red para probar en el celular).

## Pruebas

```bash
npm test
```

Usa `node --test` (sin librerías de pruebas) y corre en cada PR junto con `npm run build` (`.github/workflows/test.yml`). Además de las pruebas de lógica, `tests/e2e/` construye el sitio, lo sirve y lo abre en un Chrome real con GPS falso: comprueba que el mapa se dibuja, que las hojas abren, que WhatsApp recibe el mensaje y que sin mapa aparece el aviso de reintento. Si no hay Chrome instalado se omiten solas (o define `CHROME_PATH`). Cubren las reglas de incidentes, el almacenamiento, el GPS, WhatsApp, el mapa de calor, los nombres de sector, el reloj y la validación del Worker.

## Créditos y licencia de datos

Datos del mapa © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), disponibles bajo la licencia [ODbL](https://opendatacommons.org/licenses/odbl/). Si publicas el mapa, mantén esta atribución visible.
