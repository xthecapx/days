/**
 * Etiquetas y puntos de interés. `lod` decide desde qué zoom se dibujan:
 *   1 = siempre · 2 = zoom ≥ 1.4 · 3 = zoom ≥ 2.2
 * `kind: 'poi'` dibuja un ícono redondo; `'area'` solo texto (con halo).
 */
export const PLACES = [
  { id: 'home', kind: 'home', x: 68, y: 49, label: 'HOGAR', lod: 1 },
  { id: 'sendero', kind: 'poi', icon: '🌲', color: '#15803d', x: 81, y: 36, label: 'Sendero Río del Hato', lod: 1 },
  { id: 'autoktonos', kind: 'poi', icon: '🍴', color: '#ea580c', x: 109, y: 38, label: 'Autóktonos', lod: 2 },
  { id: 'vet', kind: 'poi', icon: '🐾', color: '#7c3aed', x: 85, y: 68, label: 'Veterinaria', lod: 3 },
  { id: 'eco', kind: 'poi', icon: '🛍', color: '#2563eb', x: 106, y: 58, label: 'Eco Centro Comercial', lod: 2 },

  { id: 'pradera', kind: 'area', x: 54, y: 50, label: 'Pradera del Hato', color: '#475569', lod: 1 },
  { id: 'azafran', kind: 'area', x: 56, y: 70, label: 'Azafrán', color: '#475569', lod: 2 },
  { id: 'terracota', kind: 'area', x: 47, y: 77, label: 'Terracota', color: '#475569', lod: 3 },
  { id: 'tierrabuena', kind: 'area', x: 62, y: 74, label: 'Ciudad Tierrabuena', color: '#64748b', lod: 2 }
];

/** Etiquetas que siguen el trazo de una vía: se rotan a lo largo del segmento. */
export const ROAD_LABELS = [
  { road: 'Autopista Piedecuesta', t: 0.2, color: '#9a4f0c', lod: 1 },
  { road: 'Vía Guatiguará', t: 0.62, color: '#7a5d12', lod: 1 },
  { road: 'Calle 13 N', t: 0.28, color: '#334155', lod: 1 },
  { road: 'Carrera 2', t: 0.72, color: '#334155', lod: 1 },
  { road: 'Carrera 4', t: 0.4, color: '#334155', lod: 2 },
  { road: 'Río del Hato', t: 0.12, color: '#1d6fb5', lod: 1, source: 'river' },
  { road: 'Río del Hato', t: 0.58, color: '#1d6fb5', lod: 2, source: 'river' },
  { road: 'Vía Río del Hato', text: 'Río del Hato', t: 0.12, color: '#334155', lod: 1 },
  { road: 'Vía Río del Hato', text: 'Río del Hato', t: 0.3, color: '#334155', lod: 2 }
];
