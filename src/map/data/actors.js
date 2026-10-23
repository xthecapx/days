import {
  HIGHWAY_PATH,
  GUATIGUARA_PATH,
  CALLE_13N_UPPER,
  CALLE_13N_LOWER,
  CARRERA_2_PATH
} from './roads.js';

const rev = (p) => [...p].reverse();

/** Vehículos que recorren las vías (decorativo). */
export const VEHICLE_ROUTES = [
  { path: CALLE_13N_LOWER, speed: 0.055, offset: 0.1, color: '#ef4444', type: 'car' },
  { path: CALLE_13N_LOWER, speed: 0.055, offset: 0.62, color: '#3b82f6', type: 'car' },
  { path: rev(CALLE_13N_UPPER), speed: 0.05, offset: 0.35, color: '#f59e0b', type: 'car' },
  { path: CARRERA_2_PATH, speed: 0.045, offset: 0.2, color: '#ffffff', type: 'car' },
  { path: rev(CARRERA_2_PATH), speed: 0.048, offset: 0.72, color: '#10b981', type: 'car' },
  { path: [[75, 53], [72, 47], [72, 42]], speed: 0.06, offset: 0.4, color: '#6366f1', type: 'car' },
  { path: GUATIGUARA_PATH, speed: 0.042, offset: 0.15, color: '#eab308', type: 'bus' },
  { path: rev(GUATIGUARA_PATH), speed: 0.052, offset: 0.55, color: '#ec4899', type: 'car' },
  { path: HIGHWAY_PATH, speed: 0.065, offset: 0.08, color: '#ffffff', type: 'car' },
  { path: HIGHWAY_PATH, speed: 0.058, offset: 0.52, color: '#38bdf8', type: 'bus' },
  { path: rev(HIGHWAY_PATH), speed: 0.062, offset: 0.3, color: '#f97316', type: 'car' },
  { path: rev(HIGHWAY_PATH), speed: 0.068, offset: 0.78, color: '#a855f7', type: 'car' }
];

/** Peatones por el sendero y el conjunto (decorativo). */
export const PEDESTRIAN_ROUTES = [
  { path: [[72, 43], [72, 37], [81, 36], [85, 31], [94, 25]], speed: 0.022, offset: 0.12, shirt: '#10b981', pants: '#1e3a8a' },
  { path: [[94, 25], [85, 31], [81, 36], [72, 37], [72, 43]], speed: 0.02, offset: 0.48, shirt: '#f97316', pants: '#0f172a' },
  { path: [[81, 36], [85, 31], [94, 25], [98, 28], [104, 19]], speed: 0.018, offset: 0.75, shirt: '#ec4899', pants: '#1e293b' },
  { path: [[62, 43], [65, 43], [72, 43]], speed: 0.025, offset: 0.3, shirt: '#38bdf8', pants: '#1e293b' },
  { path: [[64.8, 44.5], [68.5, 52.5]], speed: 0.032, offset: 0.25, shirt: '#a855f7', pants: '#0f172a' },
  { path: [[69.5, 48.2], [62.0, 51.5]], speed: 0.03, offset: 0.6, shirt: '#eab308', pants: '#1e3a8a' },
  { path: [[66, 57], [75, 53]], speed: 0.028, offset: 0.4, shirt: '#14b8a6', pants: '#0f172a' }
];
