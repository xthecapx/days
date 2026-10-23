/**
 * Estilo por clase de vía. Ancho en tiles (~14 m); colores pensados para que
 * cada jerarquía se distinga a simple vista, como en Google Maps:
 *   autopista = naranja · colectora = amarillo · arterial = blanca ·
 *   calle = blanca fina · servicio = gris · camino = arena punteado ·
 *   busway = rosado · sendero = marrón punteado.
 * `minZoom` oculta las clases pequeñas al alejar el mapa.
 */
export const ROAD_STYLES = {
  dirt: { width: 0.45, casing: '#c8b78f', fill: '#e6d9b8', order: 0, dash: [3, 3] },
  trail: { width: 0.3, casing: null, fill: '#8a6a45', order: 1, dash: [2.6, 2.4], minZoom: 0.9 },
  local: { width: 0.4, casing: '#b3bac5', fill: '#fbfbfc', order: 2, minZoom: 0.7 },
  minor: { width: 0.6, casing: '#a3acb9', fill: '#ffffff', order: 3 },
  busway: { width: 0.8, casing: '#d98a8a', fill: '#fbd0d0', order: 4 },
  arterial: { width: 0.8, casing: '#8b95a5', fill: '#ffffff', order: 5 },
  collector: { width: 1.0, casing: '#c9a24a', fill: '#fde68a', order: 6 },
  highway: { width: 1.2, casing: '#c2711a', fill: '#fbbf6a', order: 7 }
};

/** Orden de dibujo (menor → mayor jerarquía). */
export const ROAD_CLASS_ORDER = Object.keys(ROAD_STYLES).sort((a, b) => ROAD_STYLES[a].order - ROAD_STYLES[b].order);

export const WATER_STYLES = {
  river: { width: 1.5, edge: '#3d93d9', fill: '#6ec1f5', core: '#cdeafe' },
  stream: { width: 0.5, edge: '#5aa9e6', fill: '#9bd6fb', core: null },
  body: { edge: '#3d93d9', fill: '#8fd0fb' }
};

export const TERRAIN_COLORS = {
  grass: ['#bfe3a8', '#b6dc9f', '#c6e8b0'],
  park: ['#cdeab8', '#c4e4ad'],
  forest: '#8fc27f',
  forestDark: '#74ad68',
  urban: '#e5e0d5',
  industrial: '#dcd8d2',
  openLand: '#efe3c3'
};

export const BUILDING_ROOFS = ['#d9a58a', '#c98f7a', '#cdbfa6', '#bdb7ae', '#d8c9a8', '#c4a79a'];

/** Colores y prioridad de las etiquetas de vía (menor rank = se dibuja primero). */
export const LABEL_STYLES = {
  highway: { color: '#9a4f0c', rank: 0, lod: 1 },
  collector: { color: '#7a5d12', rank: 1, lod: 1 },
  arterial: { color: '#334155', rank: 2, lod: 1 },
  busway: { color: '#9f3d3d', rank: 3, lod: 2 },
  minor: { color: '#475569', rank: 4, lod: 2 },
  local: { color: '#64748b', rank: 5, lod: 3 },
  trail: { color: '#5b4326', rank: 5, lod: 2 },
  river: { color: '#1d6fb5', rank: 1, lod: 1 },
  stream: { color: '#2b7bbd', rank: 6, lod: 3 }
};
