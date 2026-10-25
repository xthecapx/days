/**
 * Sharing via WhatsApp. It does not touch the map, the selection or the incidents: it builds a message and opens WhatsApp
 * with the text already written. The person picks the chat and presses send, so nothing is published on its own.
 */

/** Formato documentado de Google Maps (Maps URLs): abre un pin en esas coordenadas. */
export const mapsLink = (lat, lng) =>
  `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;

/** wa.me without a number: WhatsApp opens the chat picker with the text ready. */
export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** Alert text. Without a position it still alerts, so no time is lost in an emergency. */
export function buildAlertMessage(position, { sector = null, now = new Date() } = {}) {
  const lines = ['🚨 NECESITO AYUDA'];
  if (position) {
    lines.push(`📍 ${mapsLink(position.lat, position.lng)}`);
    if (sector) lines.push(`📌 ${sector}`);
    const hour = now.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    lines.push(position.accuracy ? `Precisión: ±${position.accuracy} m · ${hour}` : hour);
  } else {
    lines.push('⚠️ No pude obtener mi ubicación GPS.');
  }
  return lines.join('\n');
}

/** Message to share a map point (without asking for help): sector + Google Maps link. */
export function buildPointMessage(point, sector) {
  const lines = ['📍 Ubicación compartida'];
  if (sector) lines.push(sector);
  lines.push(mapsLink(point.lat, point.lng));
  return lines.join('\n');
}

/**
 * `gps`: service from gps.js · `sectorAt(lat, lng)`: sector name or null if outside the map ·
 * `open(url)`: how to navigate (replaced in tests).
 */
export function createWhatsApp({ gps, sectorAt = () => null, open = (url) => window.location.assign(url) }) {
  return {
    /**
     * Opens WhatsApp with the alert. iOS Safari only opens the app if navigation happens inside the tap:
     * with a recent position it navigates immediately (synchronous, before any `await`); if there is none,
     * it waits for the GPS and opens anyway (best effort).
     */
    async sendAlert() {
      const position = gps.fix() || (await gps.read());
      const sector = position ? sectorAt(position.lat, position.lng) : null;
      const url = whatsappUrl(buildAlertMessage(position, { sector }));
      open(url);
      return { located: Boolean(position), url, error: position ? null : gps.error() };
    },

    sharePoint(point, sector) {
      const url = whatsappUrl(buildPointMessage(point, sector));
      open(url);
      return { url };
    }
  };
}
