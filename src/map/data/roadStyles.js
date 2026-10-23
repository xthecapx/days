/**
 * Estilo por clase de vía. Ancho en tiles; colores pensados para que cada
 * jerarquía se distinga a simple vista (como en Google Maps):
 *   autopista = naranja · colectora = amarillo · arterial = blanca ·
 *   local = gris claro fino · camino de tierra = arena punteado.
 */
export const ROAD_STYLES = {
  dirt: { width: 0.45, casing: '#c8b78f', fill: '#e6d9b8', order: 0, dash: [3, 3] },
  local: { width: 0.5, casing: '#b3bac5', fill: '#fbfbfc', order: 1 },
  minor: { width: 0.75, casing: '#a3acb9', fill: '#ffffff', order: 1.5 },
  arterial: { width: 0.85, casing: '#8b95a5', fill: '#ffffff', order: 2 },
  collector: { width: 1.15, casing: '#c9a24a', fill: '#fde68a', order: 3 },
  highway: { width: 1.6, casing: '#c2711a', fill: '#fbbf6a', order: 4, centerLine: '#ffffff' }
};

export const TERRAIN_COLORS = {
  grass: ['#bfe3a8', '#b6dc9f', '#c6e8b0'],
  forest: '#8fc27f',
  forestDark: '#74ad68',
  urban: '#e5e0d5',
  openLand: '#efe3c3',
  water: '#6ec1f5',
  waterEdge: '#3d93d9',
  waterLight: '#cdeafe',
  trail: '#8a6a45',
  trailDot: '#f8fafc'
};

export const BUILDING_ROOFS = ['#d9a58a', '#c98f7a', '#cdbfa6', '#bdb7ae', '#d8c9a8', '#c4a79a'];
export const BUILDING_TONES = {
  tower: { roof: '#b7b2c4', side: '#8d88a0' },
  shop: { roof: '#e9b1a1', side: '#c4857a' }
};
