/**
 * Map geography: the ONLY definition of the area and the grid size.
 * It is read by the browser (src/map/gpsGrid.js), the script that downloads OpenStreetMap (scripts/update-map.mjs)
 * and the Worker that validates reports (worker/github-wiki-bridge.js) and the signal one (services/signal). To widen the area, change only this
 * y ejecuta `npm run map:update`.
 *
 * It is a JS module (not a .json) because all three environments import it the same way, without import attributes.
 */

/** Map area (~2.8 km x 2.9 km). */
export const GEO_BOUNDS = { north: 7.02, south: 6.995, west: -73.076, east: -73.05 };

/** ~14 m tiles. Adjust them to keep that size if you change the area. */
export const GRID_WIDTH = 200;
export const GRID_HEIGHT = 200;
