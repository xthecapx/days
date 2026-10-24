/** Elemento por id. Si el HTML y el código se desincronizan falla con el nombre del id, no con "null". */
export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id} en index.html`);
  return el;
}

export const setHidden = (el, hidden) => el.classList.toggle('hidden', Boolean(hidden));

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Número seguro para pintar en HTML: cualquier cosa que no sea un número finito (p. ej. un texto con "<") pasa a `fallback`. */
export function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** YYYY-MM-DD en hora local (toISOString usaría UTC y puede correr el día). */
export function toIsoDate(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

let toastTimer = null;

/** Aviso breve en pantalla (role=status, lo leen los lectores de pantalla). */
export function showToast(message, ms = 3500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
