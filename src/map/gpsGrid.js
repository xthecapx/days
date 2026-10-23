/**
 * Sistema de Coordenadas "GPS de Píxeles" para el Mapa 2D Pixel Art
 * Calibrado con las capturas detalladas de Google Maps (Pradera del Hato / Sendero Río del Hato)
 */

export const GRID_WIDTH = 120;
export const GRID_HEIGHT = 80;

// Límites geográficos exactos de la vista capturada
export const GEO_BOUNDS = {
  north: 7.0120,
  south: 7.0010,
  west: -73.0715,
  east: -73.0570
};

// Ubicación del Hogar en el mapa (Píxel 68, 49)
export const USER_REFERENCE_PIXEL = {
  x: 68,
  y: 49,
  label: 'Hogar'
};

// Trazado del Río del Hato (línea azul celeste de suroeste a noreste)
export const RIVER_PATH = [
  [0, 69], [7, 67], [10, 58], [15, 55], [22, 49], [30, 47],
  [37, 46], [44, 40], [54, 41], [63, 41], [66, 39], [72, 40],
  [77, 39], [84, 34], [91, 31], [98, 25], [107, 23], [110, 17],
  [109, 12], [114, 6], [119, 2]
];

// Trazado de la Vía Río del Hato + Sendero Río del Hato
export const SENDERO_PATH = [
  [76.2, 56.1], // Esquina Exploretheworld / Calle 13 N
  [75.2, 52.8],
  [73.4, 50],
  [72.4, 47.6], // Vía Río del Hato
  [72, 43], // Vía Río del Hato arriba de Hogar (#1)
  [72, 37], // Cruza el río y sube al sendero
  [81, 36], // Parque Sendero Río del Hato
  [85, 31], // Sendero peatonal
  [94, 25], // Tramo medio-alto
  [98, 28], // Curva del sendero
  [104, 19], // Tramo alto
  [108, 12]  // Conexión norte
];

// Sendero ribereño occidental (donde están #2, #5, #6 en 63..65, 43)
export const RIVER_TRAIL_WEST = [
  [61, 44],
  [63, 43],
  [64, 43],
  [65, 43],
  [72, 43]
];

// Puntos de referencia (Landmarks) visibles en las capturas de Google Maps
export const MAP_LANDMARKS = [
  { x: 68, y: 49, name: 'Hogar (Pradera del Hato)', shortName: 'Hogar', type: 'home' },
  { x: 62, y: 51, name: 'Conjunto Residencial Pradera del Hato', shortName: 'Pradera del Hato', type: 'residential' },
  { x: 64, y: 43, name: 'Sendero Río del Hato (Ribera)', shortName: 'Sendero Río del Hato', type: 'trail' },
  { x: 72, y: 43, name: 'Vía Río del Hato', shortName: 'Vía Río del Hato', type: 'road' },
  { x: 67, y: 51, name: 'Pradera del Hato (Cerca de Hogar)', shortName: 'Pradera del Hato', type: 'residential' },
  { x: 76, y: 56, name: 'Calle 13 N / Exploretheworld', shortName: 'Calle 13 N / Exploretheworld', type: 'poi' },
  { x: 81, y: 36, name: 'Sendero Río del Hato (Parque)', shortName: 'Sendero Río del Hato', type: 'park' },
  { x: 76, y: 54, name: 'Exploretheworld (Calle 13 N)', shortName: 'Exploretheworld', type: 'poi' },
  { x: 69, y: 59, name: 'Cruce Carrera 2 con Calle 13 N', shortName: 'Cra 2 / Calle 13 N', type: 'road' },
  { x: 60, y: 71, name: 'Azafrán - Ciudad Tierrabuena', shortName: 'Azafrán Tierrabuena', type: 'residential' },
  { x: 51, y: 77, name: 'Conjunto Terracota', shortName: 'Conjunto Terracota', type: 'residential' },
  { x: 83, y: 69, name: 'Veterinaria De Pelos.com (Vía Guatiguará)', shortName: 'Veterinaria De Pelos', type: 'poi' },
  { x: 109, y: 38, name: 'Autóktonos Alta Parrilla', shortName: 'Autóktonos', type: 'food' },
  { x: 112, y: 24, name: 'Autopista Piedecuesta', shortName: 'Autopista Piedecuesta', type: 'highway' },
  { x: 108, y: 63, name: 'Vía Guatiguará / Eco Centro Comercial', shortName: 'Vía Guatiguará', type: 'commercial' }
];

export function pixelToGps(px, py) {
  const clampedX = Math.max(0, Math.min(GRID_WIDTH - 1, Math.round(px)));
  const clampedY = Math.max(0, Math.min(GRID_HEIGHT - 1, Math.round(py)));

  const lng = GEO_BOUNDS.west + (clampedX / (GRID_WIDTH - 1)) * (GEO_BOUNDS.east - GEO_BOUNDS.west);
  const lat = GEO_BOUNDS.north - (clampedY / (GRID_HEIGHT - 1)) * (GEO_BOUNDS.north - GEO_BOUNDS.south);

  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    pixelX: clampedX,
    pixelY: clampedY
  };
}

export function gpsToPixel(lat, lng) {
  const normX = (lng - GEO_BOUNDS.west) / (GEO_BOUNDS.east - GEO_BOUNDS.west);
  const normY = (GEO_BOUNDS.north - lat) / (GEO_BOUNDS.north - GEO_BOUNDS.south);

  const px = Math.round(normX * (GRID_WIDTH - 1));
  const py = Math.round(normY * (GRID_HEIGHT - 1));

  const insideBounds = px >= 0 && px < GRID_WIDTH && py >= 0 && py < GRID_HEIGHT;

  return {
    pixelX: Math.max(0, Math.min(GRID_WIDTH - 1, px)),
    pixelY: Math.max(0, Math.min(GRID_HEIGHT - 1, py)),
    insideBounds
  };
}

export function distanceToPolyline(px, py, polyline) {
  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const [x1, y1] = polyline[i];
    const [x2, y2] = polyline[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    }
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const dist = Math.hypot(px - projX, py - projY);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

export function detectSectorName(px, py) {
  if (Math.hypot(px - USER_REFERENCE_PIXEL.x, py - USER_REFERENCE_PIXEL.y) <= 2.2) {
    return 'Hogar — Pradera del Hato (68, 49)';
  }
  if (Math.hypot(px - 72, py - 43) <= 3.2) {
    return 'Vía Río del Hato (Arriba de Hogar)';
  }
  if (px >= 61 && px <= 68 && py >= 41 && py <= 45) {
    return 'Sendero Río del Hato';
  }
  if (px >= 64 && px <= 72 && py >= 46 && py <= 55) {
    return 'Conjunto Residencial Pradera del Hato';
  }
  if (Math.hypot(px - 76, py - 56) <= 3.5) {
    return 'Calle 13 N / Exploretheworld';
  }

  const distSendero = distanceToPolyline(px, py, SENDERO_PATH);
  if (distSendero <= 4.0) {
    if (py >= 40) return 'Vía Río del Hato';
    if (py >= 30) return 'Sendero Río del Hato (Tramo Medio)';
    return 'Sendero Río del Hato (Tramo Alto)';
  }

  const distRiver = distanceToPolyline(px, py, RIVER_PATH);
  if (distRiver <= 3.2) {
    return 'Ronda del Río del Hato';
  }

  let closest = null;
  let minD = Infinity;
  for (const lm of MAP_LANDMARKS) {
    const d = Math.hypot(px - lm.x, py - lm.y);
    if (d < minD) {
      minD = d;
      closest = lm;
    }
  }
  if (closest && minD <= 10) {
    return closest.name;
  }

  if (px > 106) return 'Sector Autopista Piedecuesta';
  if (px >= 42 && px <= 88 && py >= 45) return 'Urbanización Ciudad Tierrabuena';
  return 'Zona Verde / Cuenca Río del Hato';
}
