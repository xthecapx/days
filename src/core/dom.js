/** Element by id. If the HTML and the code get out of sync it fails with the id name, not with "null". */
export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} is missing from index.html`);
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

/** Number that is safe to render into HTML: anything that is not a finite number (e.g. text containing "<") becomes `fallback`. */
export function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** YYYY-MM-DD in local time (toISOString would use UTC and can shift the day). */
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
