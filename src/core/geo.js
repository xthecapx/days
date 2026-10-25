/**
 * Geografía del mapa: la ÚNICA definición del área y del tamaño de la grilla.
 * La leen el navegador (src/map/gpsGrid.js), el script que baja OpenStreetMap (scripts/update-map.mjs)
 * y el Worker que valida los reportes (worker/github-wiki-bridge.js) y el de la señal (services/signal). Para ampliar el área, cambia solo esto
 * y ejecuta `npm run map:update`.
 *
 * Es un módulo JS (no un .json) porque los tres entornos lo importan igual, sin atributos de importación.
 */

/** Área del mapa (~2.8 km x 2.9 km). */
export const GEO_BOUNDS = { north: 7.02, south: 6.995, west: -73.076, east: -73.05 };

/** Tiles de ~14 m. Ajústalos para mantener ese tamaño si cambias el área. */
export const GRID_WIDTH = 200;
export const GRID_HEIGHT = 200;
