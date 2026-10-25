# Monitor Vecinal — Sendero Río del Hato

A web app that is **100% anonymous** and ready to publish for free on **GitHub Pages**. The app's interface is in Spanish; code, comments, tests and documentation are in English. It shows a map of the area with the incidents reported by neighbors and the days elapsed since the last one. Incidents live in `data/incidents.json`, an open database: each report arrives as a Pull Request and is only published when the owner approves it.

## Features

1. **A `DÍAS DESDE EL ÚLTIMO INCIDENTE` ("days since the last incident") counter** with a summary of the latest report and the pixels on alert.
2. **Area map** (~2.8 × 2.9 km, Piedecuesta) drawn from OpenStreetMap data: streets by hierarchy, rivers, trails, street names, places, and animated cars and pedestrians.
3. **Heat map** over a 200 × 200 tile grid (~14 m each): every incident tints the neighboring tiles according to severity (1 to 5) and age. Red = safety, yellow = noise/coexistence.
4. **Open, moderated incident reports**: report, edit, confirm and move from the app itself. The change history is git's (one Pull Request per report).
5. Designed for **mobile**: a single bottom sheet, 44 px touch buttons, pinch to zoom.
6. **Help signal between neighbors** (🆘): one person raises the alert with a tap, and anyone who is listening sees the point on the map. See [Help signal](#help-signal).

## Local use

You need Node 20.19+ or 22.12+ (there is an `.nvmrc`).

```bash
npm install     # only once
npm run dev     # development server (Vite) at http://localhost:5173
```

Open `http://localhost:5173`. On `localhost`, every change made from the interface is saved directly to `data/incidents.json` and is **not** sent to the bridge. On a phone use `http://<your-computer-IP>:5173` (same Wi-Fi network), but note that with an IP the app behaves as in production and **saving a report opens a Pull Request** through the Cloudflare Worker. To test from a phone without publishing, run this once in the browser console and reload:
>
> ```js
> localStorage.setItem('vecinos_rio_hato_github_bridge_v1', JSON.stringify({bridgeUrl:'', githubRepo:'xthecapx/days'}))
> ```

## How the map is organized

The map has **three data layers** and all of them use real coordinates (lat/lng):

| File | What it contains | Who edits it |
|---|---|---|
| `data/map.json` | Streets, rivers, trails and areas downloaded from OpenStreetMap | Generated with `npm run map:update`. Do not edit it by hand. |
| `data/map-overrides.json` | Your adjustments: HOGAR (home), places, sectors, road classes, extra or hidden roads | **You**, by hand. Never overwritten. |
| `data/incidents.json` | Incidents | The app (and you, for corrections). |

Incidents are stored with `lat`/`lng`. The `(pixelX, pixelY)` tile is recomputed on every load, so **changing the area or the grid size never moves an incident**.

## Updating the map

### Fetching new data from OpenStreetMap

```bash
npm run map:update
```

This downloads the area defined in `src/core/geo.js` and rewrites `data/map.json`. If the public server (Overpass) is overloaded, the script retries with other servers; if it fails completely, wait a few minutes and try again. Then reload the app and run `git add data/map.json`.

### Changing or expanding the area

1. Edit `GEO_BOUNDS` (`south`, `north`, `west`, `east`) and, if needed, `GRID_WIDTH`/`GRID_HEIGHT` in `src/core/geo.js`. It is the only place: the map, the script and the Worker that validates reports all read it from there.
2. Keep tiles at ~14 m (area in meters ÷ 14).
3. Run `npm run map:update`.
4. If you changed the Worker or the bounds, it is redeployed automatically when you push to `main`.

Incidents relocate themselves. Much larger areas (a whole city) need a different architecture: the map is drawn on a single canvas and the data lives in a single file.

### Fixing what OpenStreetMap lacks or gets wrong

Everything is done in `data/map-overrides.json` (it is preserved when you update):

- **`home`**: `{ "lat", "lng", "label" }` — the house marked on the map.
- **`places`**: places with an icon (`kind: "poi"`) or text only (`kind: "area"`). `lod` decides from which zoom they are visible: `1` always, `2` zoom ≥ 1.4, `3` zoom ≥ 2.2.
- **`sectors`**: zone names by radius: `{ "name", "lat", "lng", "radiusM" }`. They are used when reporting and in the bottom bar.
- **`roadClass`**: changes a street's class by name, e.g. `{ "Avenida Calle 13 Norte": "arterial" }`. Classes: `highway`, `collector`, `arterial`, `minor`, `local`, `busway`, `trail`, `dirt`.
- **`rename`**: fixes names, e.g. `{ "Río Lato del Hato": "Río del Hato" }`.
- **`hideWays`**: ids (or names) of OSM ways you do not want to see.
- **`extraRoads`**: missing roads: `{ "cls", "name", "pts": [[lat,lng], …] }`.
- **`areas`**: extra areas (e.g. open ground): `{ "kind", "pts": [[lat,lng], …] }`.

To get the lat/lng of a point: right-click in Google Maps or on openstreetmap.org → copy coordinates.

If something is wrong in OpenStreetMap itself (a street that is missing for everyone), you can also fix it there on [openstreetmap.org](https://www.openstreetmap.org) and run `npm run map:update` again.

### Road style

Colors, widths and when roads are hidden as the map zooms out are in `src/map/data/roadStyles.js`.

### What OpenStreetMap does not provide here

There are no buildings in this area: the houses on the map are decoration generated by the code (`src/map/render/baseMap.js`).

## Code structure

```
index.html             Structure of the screen
data/                  map.json · map-overrides.json · incidents.json
scripts/update-map.mjs Download from OpenStreetMap
vite.config.js        Vite: development server, bundling and copying of data/
services/signal/       Help-signal server (Cloudflare Worker + Durable Object), independent of the interface
worker/                Report bridge (Cloudflare Worker + its wrangler.jsonc): opens a PR for each report
tests/                 Tests with node:test (logic) and tests/e2e (real browser)
public/                Files copied as-is to the site (favicon)
src/main.js            Wires all the pieces together
src/state/             Store with subscriptions, actions and selectors
src/core/geo.js        Map area and grid size (single definition)
src/core/clock.js      The app's "today": follows the device clock
src/domain/            Pure incident rules (no DOM or network)
src/services/          Use cases (incidents), help signal (signalApi/Feed/Service) and phone services (gps.js, whatsapp.js)
src/storage/           Adapters: repository, browser copy, local disk and bridge (PR)
src/map/               Camera, grid, map model (`buildWorld`, `createSectorNamer`), heat map
src/map/render/        One drawing layer per file (base, heat and its colors, labels, markers…)
src/ui/                HUD (hud, alertCard, peek, whatsappMenu, syncToast, insets), bottom sheet and map gestures
src/ui/panes/          One sheet panel per file: incidents, settings, report
src/styles/            base.css · hud.css · sheets.css
```

## Publishing for free on GitHub Pages

1. Push this repository to GitHub.
2. In **Settings → Pages → Build and deployment** choose **GitHub Actions**. The `.github/workflows/deploy-pages.yml` workflow runs `npm ci && npm run build` and publishes only `dist/`: `index.html`, one `.js` and one `.css` bundled by Vite (with a hash in the name, so a new deployment never mixes with stale cached files) and `data/` copied as-is. The Worker, the scripts and the tests are not published. To see that same result locally: `npm run build && npm run preview`.
3. *(Optional, so neighbors can edit without a GitHub account)*: deploy `worker/` (its `wrangler.jsonc` is there) to Cloudflare Workers with a token restricted to `data/incidents.json`, and set the `GITHUB_TOKEN` variable.

> **Deploy from a branch** also works, but it publishes the whole repository as-is.

## Help signal

A «necesito ayuda aquí» ("I need help here") alert between neighbors. **It does not replace 123** (the emergency number): the screen itself says so. It is a proof of concept.

**How it works**

1. Someone taps 🆘 in the app, or uses a phone shortcut (see [Phone shortcuts](#phone-shortcuts)). Only their position is sent.
2. When the page is opened or reloaded, the app reads the server **once**: if there is an active alert, a red notice appears along with a 🆘 pulsing on the map.
3. Whoever turns on **«Avisarme cuando alguien pida ayuda»** ("Notify me when someone asks for help") (🆘 sheet) asks the server **every 30 s**, and **only while the screen is in view**. With the tab hidden or the phone locked nothing is requested: there are no push notifications and nothing runs in the background.
4. The green number above the 🆘 button is how many neighbors are listening right now (visible to everyone). Each listener counts for up to 75 s after their last request.

**What is stored (and what is not)**

- For each alert only the **map cell (~14 m)**, the time and a random identifier are stored. Never the exact coordinates, the accuracy, a name or free text.
- The IP is not stored: it is turned into a hash with a server secret (`SIGNAL_PEPPER`) only to limit the rate and allow one alert per person. It does not appear in any response.
- An alert lasts **30 minutes** and then disappears. Whoever sent it from the app can withdraw it earlier; the permission to do so (a token) lives only in their browser.
- There are no accounts or users. Anyone with the address can send or read: this is an accepted risk in this proof of concept (see [Known limits](#known-limits)).

**Server** (`services/signal/`, Cloudflare Worker + Durable Object with SQLite). URL: `https://days-signal.xthecapx.workers.dev/`

| Method and route | What it does |
|---|---|
| `GET /` | Service status (is a secret configured?). Carries no data. |
| `GET /state` | Active alerts and how many are listening. Public, does **not** count you as a listener. |
| `POST /poll` `{listener, listening}` | Same as `/state`, and counts you in (or out) as a listener. |
| `POST /signal` `{lat, lng}` | Creates your alert (replaces the previous one from the same connection). Returns the token to withdraw it. |
| `POST /signal/cancel` `{id, token}` | Withdraws an alert with its token. |

**Everything is real: there are no rooms and no test mode.** Whatever you send is seen by anyone who opens the app. (Old links or shortcuts with `?room=…` still work: the parameter is ignored.) Coordinates can arrive as a number or as text, even with a decimal comma (`"7,005"`), and the body can be JSON or a form: this is how iPhone Shortcuts (the «Atajos» app) sends them.

**Server limits:** only inside the map area · 6 alerts/min and 30 requests/min per connection (approx.) · one alert per person · at most 20 alerts and 1000 listeners · bodies up to 2 KB · only `https://xthecapx.github.io` can call from a browser (phone shortcuts do not send `Origin`).

**Local development**

```bash
npm run signal:dev   # local server at http://localhost:8787 (accepts localhost and the local network)
npm run dev          # the app, pointing at that local server
```

`vite dev` uses that local server because the published one only accepts calls from `https://xthecapx.github.io` (CORS). **The local server has its own memory: what you send there does not reach the published app.** A built copy (`npm run preview`) served from your computer **cannot** talk to the published server (the browser blocks it because of CORS), so there the help signal shows «sin conexión» ("offline"): to test the signal end to end use the published site, or `npm run dev` together with `npm run signal:dev`.

### Phone shortcuts

To ask for help without opening the app. **They have to be created once on each phone.**

**Everything is real.** A shortcut sends a real alert: it shows up in the published app for 30 minutes and anyone who opens it sees it. Warn the people around you before testing, or test yourself with two phones.

**iPhone (the Shortcuts app, «Atajos» in the Spanish iOS)** — one «Obtener ubicación actual» (Get Current Location) action and one «Obtener contenido de URL» (Get Contents of URL) action:

1. Atajos → **+** → name it «Pedir ayuda» ("Ask for help").
2. **Obtener ubicación actual** (Get Current Location).
3. **Obtener contenido de URL** (Get Contents of URL):
   - URL: `https://days-signal.xthecapx.workers.dev/signal`
   - *Mostrar más* (Show More) → Method **POST** → Request Body **Formulario** (Form) (or JSON).
   - Two **Texto** (Text) fields: `lat` = *Ubicación actual* (Current Location) → **Latitud** (Latitude), and `lng` = *Ubicación actual* → **Longitud** (Longitude).
4. **Mostrar notificación** (Show Notification) with the result, so you know it went out.
5. Give it a trigger: *Ajustes → Botón de acción* (Settings → Action Button), *Tocar atrás* (Back Tap), a Home Screen / Lock Screen widget, or say «Oye Siri, pedir ayuda» ("Hey Siri, ask for help").

**Android** — the free app [HTTP Shortcuts](https://http-shortcuts.rmy.ch/): a shortcut with a POST method to the same URL (`…/signal`) and a body with `lat` and `lng`; add it as a widget on the home screen. *I have not been able to verify whether it lets you insert the current location in the body*; if it does not, use the app icon (next item).

**Home screen icon (iPhone and Android):** open the app at `https://xthecapx.github.io/days/?sos=1` → *Share → Add to Home Screen*. Opening it lands directly on the help screen, with the confirm button already showing. On Android (Chrome) the installed icon also offers «Pedir ayuda» ("Ask for help") when you long-press it.

**Traccar Client and OwnTracks do not work here.** They are continuous trackers that send your position in the background and identify themselves with a device id: the opposite of a one-off, anonymous signal. I also did not find a "send now" button in Traccar Client.

### Known limits

- **Anyone with the address can send a false alert**: there are no accounts or keys. The map area, the rate limit, one alert per person and the 30-minute lifetime slow it down; they do not prevent it. If this reaches real users, the next step is a key in the shortcut or a role.
- **Anyone who opens the app sees the active alerts** (at ~14 m), even if they are not listening.
- **With the screen locked or the tab hidden nothing is received.** There are no push notifications.
- **An alert sent from a shortcut cannot be withdrawn from the app** (the token stays in the shortcut); it expires on its own after 30 min or is replaced by sending another.
- **If the Cloudflare free plan runs out**, the signal stops responding until 00:00 UTC; the app shows this and reminds you to call 123 or use WhatsApp.
- The listener count is approximate and can be faked.

## Two independent deployments

| What | Where | Published when these change… | Workflow |
|---|---|---|---|
| Interface (map, reports) | GitHub Pages | `src/`, `index.html`, `public/`, **`data/`**, `vite.config.js`, dependencies | `deploy-pages.yml` |
| Help-signal server | Cloudflare Worker (`days-signal`) | `services/signal/` and the map bounds it shares (`src/core/geo.js`, `src/map/gpsGrid.js`) | Cloudflare Workers Builds (GitHub connection in the dashboard; see below) |
| Report bridge (opens the Pull Request) | Cloudflare Worker (`days`) | `worker/` and the map bounds it shares (`src/core/geo.js`) | Cloudflare Workers Builds (see below) |

**Each Worker has its own folder and its own `wrangler.jsonc`; there is none at the repository root.** With a `wrangler.jsonc` at the root, Cloudflare builds that Worker on *every* push to `main`, whether or not its code was touched. For each Worker to be built only when its own files change, two things must be set in the Cloudflare dashboard of **each** Worker:

| Worker | *Root directory* | *Build watch paths* (include) |
|---|---|---|
| `days` (report bridge) | `worker` | `worker/*`, `src/core/geo.js` |
| `days-signal` (help signal) | `services/signal` | `services/signal/*`, `src/core/geo.js`, `src/map/gpsGrid.js` |

`Deploy command` stays at its default (`npx wrangler deploy`) and `Build command` empty. If a Worker keeps building on every push, it is almost always because its *Root directory* is empty (it uses the root) or its *watch path* is missing. `tests/workflows.test.js` checks that there is never a `wrangler.jsonc` at the root again.

**Connecting the signal server (once, in the Cloudflare dashboard):** Workers & Pages → *Create application* → import this repository, with these values:

- Worker name: `days-signal` (the same as in `services/signal/wrangler.jsonc`).
- *Root directory*: `services/signal`.
- *Deploy command*: the usual one (`npx wrangler deploy`).
- *Build watch paths* (include): `services/signal/*`, `src/core/geo.js`, `src/map/gpsGrid.js`. This way interface changes do not trigger a build of it.
- The `SIGNAL_PEPPER` secret is created on the Worker, in *Settings → Variables and Secrets*, as a **Secret** (*Build variables* do not reach the running Worker).

The server tests run on every PR together with the rest (`test.yml`); Cloudflare only builds what is already on `main`.

`data/` is in the interface list on purpose: an approved report changes `data/incidents.json` and has to be published (`tests/workflows.test.js` checks this). The tests (`test.yml`) always run. `.npmrc` pins the public npm registry: without it, a private registry in your personal configuration leaks into `package-lock.json` and GitHub Actions cannot install (a test guards against this).

## Security

- The published site carries a **content security policy** (`<meta http-equiv="Content-Security-Policy">`, defined in `vite.config.js`): only its own scripts and styles, and the only outbound connections are Google Fonts, GitHub (reading `incidents.json`) and the Worker. If you add another external service, add it there or the browser will block it.
- The report form **does not suggest a date or time**: the person chooses «Hoy», «Ayer» or «Otro día» ("Today", "Yesterday" or "Another day"), so the day a report is made is never saved as the day it happened (which is what "days since the last incident" counts). The map color comes from the category, and the save button is disabled while saving so that two Pull Requests are not opened.
- The help signal goes to a separate server (`services/signal`); the report flow neither uses nor knows about it. Details, limits and privacy in [Help signal](#help-signal).
- All neighbor-provided text is escaped before being rendered, and numbers coming from `incidents.json` are converted with `toNumber`.
- In development, the endpoint that writes `data/incidents.json` only accepts requests from this same computer (even if the server is open to the network for testing on a phone).

## Tests

```bash
npm test
```

It uses `node --test` (no test libraries) and runs on every PR together with `npm run build` (`.github/workflows/test.yml`). Besides the logic tests, `tests/e2e/` builds the site, serves it and opens it in a real Chrome with fake GPS: it checks that the map is drawn, that the sheets open, that WhatsApp receives the message and that the retry notice appears when there is no map. If Chrome is not installed they skip themselves (or set `CHROME_PATH`). They cover the incident rules, storage, GPS, WhatsApp, the heat map, sector names, the clock and the Worker's validation.

## Credits and data license

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [ODbL](https://opendatacommons.org/licenses/odbl/) license. If you publish the map, keep this attribution visible.
