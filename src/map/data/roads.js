import { RIVER_PATH, SENDERO_PATH, RIVER_TRAIL_WEST } from '../gpsGrid.js';

/**
 * Geometría del mapa en coordenadas de tile (120×80).
 * Cada vía declara su clase; el estilo vive en `roadStyles.js`.
 * Para agregar una calle nueva basta con añadirla a ROADS.
 */

export const HIGHWAY_PATH = [
  [107, 0], [109, 10], [112, 22], [111, 36], [111, 47], [114, 58], [118, 70], [119, 79]
];
export const GUATIGUARA_PATH = [
  [73, 79], [79, 73], [86, 68], [96, 65], [106, 61], [114, 58], [119, 55]
];
// Doble calzada Calle 13 N: ~8 tiles al sur de HOGAR, pasa bajo Exploretheworld y cruza Carrera 2
export const CALLE_13N_UPPER = [[44, 69.6], [56, 62.8], [62, 60], [68, 57], [75, 54.4], [83.4, 51.6]];
export const CALLE_13N_LOWER = CALLE_13N_UPPER.map(([x, y]) => [x, y + 1]);
export const CARRERA_2_PATH = [[66, 49], [67.5, 53], [69, 57.4], [71.5, 63.5], [73.5, 69], [76, 79]];

// Tres calles paralelas del conjunto (HOGAR queda entre la 2ª y la 3ª), travesaños y el gancho en J
const PRADERA_STREETS = [
  [[65.5, 44.2], [68.9, 54.8]],
  [[66.9, 43.7], [70.3, 54.2]],
  [[68.3, 43.2], [71.7, 53.6]],
  [[65.9, 48.4], [69.6, 46.9]],
  [[66.9, 52], [71.2, 50.2]],
  [[71.6, 52.6], [73, 51.4], [72.9, 50.2], [73.4, 49.8]]
];

// Calle paralela a Carrera 2, un poco al occidente
const WEST_PARALLEL = [[66.5, 58.2], [67.5, 60.3], [68.7, 64.3], [69.3, 68.5], [70, 74], [70.5, 79]];
// Carrera 4
const CARRERA_4 = [[82.9, 58], [84, 62], [85, 66], [86.2, 70], [87, 79]];

const SOUTH_STREETS = [
  [[63, 60], [65, 65]],
  [[64, 64], [66.5, 65]],
  [[69, 68], [70, 64], [74, 61], [79, 60], [81, 65], [84, 71]],
  [[72, 65], [77, 63], [82, 69]],
  [[76, 67], [80, 66]],
  [[46, 70], [56, 77]],
  [[50, 68], [59, 74]],
  [[88, 68], [91, 79]],
  [[95, 65], [98, 79]],
  [[103, 62], [101, 79]],
  [[88, 74], [105, 70]]
];

const DIRT_ROADS = [
  [[19, 79], [19, 71], [24, 65], [25, 57], [21, 51]],
  [[24, 65], [29, 73], [28, 79]],
  [[58, 18], [64, 14], [70, 19]],
  [[62, 11], [67, 16], [76, 11]]
];

/** Clases de vía, de menor a mayor jerarquía (se pintan en este orden). */
export const ROADS = [
  ...DIRT_ROADS.map((pts) => ({ cls: 'dirt', pts })),
  ...SOUTH_STREETS.map((pts) => ({ cls: 'local', pts })),
  ...PRADERA_STREETS.map((pts) => ({ cls: 'minor', pts })),
  // Vía Río del Hato: calle real (autos y peatones) desde la esquina de Exploretheworld hasta el sendero
  { cls: 'minor', pts: SENDERO_PATH, name: 'Vía Río del Hato' },
  { cls: 'minor', pts: WEST_PARALLEL },
  { cls: 'minor', pts: CARRERA_4, name: 'Carrera 4' },
  { cls: 'arterial', pts: CARRERA_2_PATH, name: 'Carrera 2' },
  { cls: 'arterial', pts: CALLE_13N_UPPER, name: 'Calle 13 N' },
  { cls: 'arterial', pts: CALLE_13N_LOWER },
  { cls: 'collector', pts: GUATIGUARA_PATH, name: 'Vía Guatiguará' },
  { cls: 'highway', pts: HIGHWAY_PATH, name: 'Autopista Piedecuesta' }
];

export const TRAILS = [{ pts: RIVER_TRAIL_WEST }];

export const RIVER = { pts: RIVER_PATH, name: 'Río del Hato' };

export const URBAN_POLY = [
  [59, 42], [73, 44], [76, 51], [83, 50], [87, 66], [118, 52],
  [119, 79], [48, 79], [44, 68], [59, 57], [58, 46], [59, 42]
];
export const OPEN_LAND_POLY = [
  [74, 48], [95, 36], [111, 42], [113, 57], [93, 65], [81, 56], [74, 48]
];

/** Conjuntos / torres con nombre propio (x, y, ancho, alto en tiles). */
export const LANDMARK_BLOCKS = [
  { x: 58.6, y: 47.4, w: 1.6, h: 3.2, tone: 'tower' },
  { x: 58.6, y: 51.2, w: 1.6, h: 3.0, tone: 'tower' },
  { x: 54.0, y: 64.0, w: 3.0, h: 2.2, tone: 'tower' },
  { x: 49.0, y: 74.0, w: 3.2, h: 2.4, tone: 'tower' },
  { x: 76.4, y: 57.2, w: 3.0, h: 1.8, tone: 'shop' },
  { x: 84.0, y: 66.0, w: 2.6, h: 1.8, tone: 'shop' },
  { x: 104.0, y: 56.5, w: 4.0, h: 2.6, tone: 'shop' },
  { x: 108.0, y: 37.0, w: 2.0, h: 1.6, tone: 'shop' }
];
