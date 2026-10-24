/**
 * Reglas puras sobre incidentes: sin DOM, sin red, sin almacenamiento ni estado global.
 * Todo lo que necesita del mundo exterior (la hora, el sector, las coordenadas) entra por parámetros.
 */

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/** Días transcurridos desde una fecha YYYY-MM-DD hasta `nowDate` (por día de calendario, nunca negativo). */
export function calculateDaysSince(dateStr, nowDate = new Date()) {
  if (!dateStr) return 30;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return 30;

  const target = new Date(year, month - 1, day, 12, 0, 0);
  const current = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), 12, 0, 0);
  const days = Math.floor((current.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
}

/** ¿Es de tranquilidad/convivencia (amarillo) y no de seguridad (rojo)? */
export function isTranquilityIncident(inc) {
  if (!inc) return false;
  if (inc.impactType === 'tranquilidad') return true;
  const cat = String(inc.category || '').toLowerCase();
  return cat.includes('ruido') || cat.includes('convivencia') || cat.includes('tranquilidad');
}

/** Último incidente por fecha del hecho (`date`), nunca por cuándo se reportó. */
export function latestIncident(incidents) {
  if (!incidents.length) return null;
  return [...incidents].sort((a, b) => {
    const cmp = (b.date || '').localeCompare(a.date || '');
    return cmp !== 0 ? cmp : (b.number || 0) - (a.number || 0);
  })[0];
}

export function formatSpanishDateLabel(dateStr, timeStr, dateConfirmed = true, timeConfirmed = true) {
  let datePart = 'Fecha por confirmar';
  if (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (y && m && d) {
      datePart = `${d} de ${MONTHS[m - 1]}`;
      if (!dateConfirmed) datePart += ' (Por confirmar)';
    }
  }

  let timePart = 'Hora por confirmar';
  if (timeStr && timeConfirmed) {
    const [hh, mm] = timeStr.split(':').map(Number);
    if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
      const period = hh >= 12 ? 'p. m.' : 'a. m.';
      const h12 = hh % 12 || 12;
      timePart = `${h12}:${String(mm).padStart(2, '0')} ${period}`;
    }
  } else if (timeStr && !timeConfirmed) {
    timePart = `${timeStr} (Hora por confirmar)`;
  }

  return `${datePart} - ${timePart}`;
}

const nextIncidentNumber = (incidents) => incidents.reduce((max, i) => Math.max(max, i.number || 0), 0) + 1;

/** Campos que el formulario controla, ya normalizados. Los comparten crear y editar. */
function formFields(input, { coords, sector }) {
  const dateConfirmed = Boolean(input.dateConfirmed);
  const timeConfirmed = Boolean(input.timeConfirmed);
  return {
    date: input.date,
    time: input.time || '12:00',
    dateLabel: formatSpanishDateLabel(input.date, input.time, dateConfirmed, timeConfirmed),
    dateConfirmed,
    timeConfirmed,
    impactType: input.impactType === 'tranquilidad' ? 'tranquilidad' : 'seguridad',
    category: input.category,
    severity: Number(input.severity) || 3,
    pixelX: coords.pixelX,
    pixelY: coords.pixelY,
    lat: coords.lat,
    lng: coords.lng,
    sector,
    description: input.description.trim(),
    // Quién resolvió el caso (por ahora solo 'policia'); null = sin resolver.
    resolvedBy: input.resolvedBy === 'policia' ? 'policia' : null
  };
}

/**
 * Incidente nuevo (sin `existing`) o editado (con `existing`).
 * `coords` = { pixelX, pixelY, lat, lng } ya acotado a la grilla; `sector` = nombre ya resuelto.
 */
export function buildIncident(input, { existing = null, incidents = [], coords, sector, now = new Date() }) {
  const fields = formFields(input, { coords, sector });
  const updatedAt = now.toISOString();

  if (existing) return { ...existing, ...fields, updatedAt };

  const number = nextIncidentNumber(incidents);
  return {
    id: `inc-${String(number).padStart(3, '0')}-${now.getTime().toString(36).slice(-3)}`,
    number,
    ...fields,
    confirmations: 1,
    updatedAt
  };
}

/** Un voto de confirmación más. */
export const confirmedIncident = (inc, now = new Date()) => ({
  ...inc,
  confirmations: (inc.confirmations || 1) + 1,
  updatedAt: now.toISOString()
});

/** Mensaje que se envía al puente (Worker) para abrir el PR: solo los campos que el Worker acepta. */
export function buildSaveChange(incident, isEdit) {
  return {
    type: isEdit ? 'edit' : 'create',
    incident: {
      id: incident.id,
      date: incident.date,
      time: incident.time,
      dateLabel: incident.dateLabel,
      dateConfirmed: incident.dateConfirmed,
      timeConfirmed: incident.timeConfirmed,
      impactType: incident.impactType,
      category: incident.category,
      severity: incident.severity,
      pixelX: incident.pixelX,
      pixelY: incident.pixelY,
      lat: incident.lat,
      lng: incident.lng,
      sector: incident.sector,
      description: incident.description,
      resolvedBy: incident.resolvedBy
    }
  };
}

export const buildConfirmChange = (id) => ({ type: 'confirm', id });
