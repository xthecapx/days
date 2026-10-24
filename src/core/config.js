export const ZOOM = { min: 0.35, max: 5.5 };

export const SEVERITY_NAMES = {
  1: '1 / 5 (Baja)',
  2: '2 / 5 (Moderada)',
  3: '3 / 5 (Media-Alta)',
  4: '4 / 5 (Alta)',
  5: '5 / 5 (Crítica)'
};

/** Agregar una categoría aquí la hace disponible en el formulario. */
export const CATEGORIES = [
  { value: 'Violencia / Robo y Lesiones', label: 'Violencia / Robo y Lesiones', impact: 'seguridad' },
  { value: 'Hurto a Residencia', label: 'Hurto a Residencia', impact: 'seguridad' },
  { value: 'Persecución / Orden Público', label: 'Persecución / Orden Público', impact: 'seguridad' },
  { value: 'Invasión de Sendero / Peligro Vial', label: 'Invasión de Sendero (Motos)', impact: 'seguridad' },
  { value: 'Ruido Excesivo / Convivencia', label: 'Ruido Excesivo / Convivencia', impact: 'tranquilidad' },
  { value: 'Sospechosos / Merodeo en el Río', label: 'Sospechosos / Merodeo', impact: 'seguridad' },
  { value: 'Otro Incidente en el Sector', label: 'Otro Incidente', impact: 'seguridad' }
];

export const DEFAULT_CATEGORY = CATEGORIES[0].value;
