import { isLocalhost } from '../core/env.js';

/** Lee data/incidents.json del repositorio: primero GitHub (lo último aprobado), luego el archivo servido. */

async function getJson(url, label) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return await res.json();
    console.warn(`${label}: HTTP ${res.status}`);
  } catch (err) {
    console.warn(`${label}: no se pudo cargar`, err);
  }
  return null;
}

/** null si no hay conexión a ninguna de las dos fuentes. */
export async function loadFromRepository({ githubRepo }) {
  if (!isLocalhost() && githubRepo) {
    const raw = await getJson(
      `https://raw.githubusercontent.com/${githubRepo}/main/data/incidents.json?t=${Date.now()}`,
      'GitHub'
    );
    if (raw) return raw;
  }
  return getJson(`./data/incidents.json?t=${Date.now()}`, './data/incidents.json');
}

/** Los incidentes iniciales que trae este despliegue. Lanza si no se pueden leer. */
export async function fetchSeed() {
  const res = await fetch(`./data/incidents.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo leer data/incidents.json (HTTP ${res.status})`);
  return res.json();
}
