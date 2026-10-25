/**
 * Sends a change to the bridge (Cloudflare Worker), which opens a Pull Request. Nothing is published until
 * the owner approves it. Always returns a readable sync state; never throws.
 */
export async function sendChange(bridgeUrl, change, commitSummary) {
  try {
    const res = await fetch(bridgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitMessage: `Wiki Vecinal: ${commitSummary}`, change })
    });
    if (res.ok) {
      return { mode: 'pr', ok: true, message: 'Enviado para revisión (aparecerá cuando se apruebe)' };
    }
    if (res.status === 429) {
      return {
        mode: 'github-limited',
        ok: false,
        message: 'Guardado localmente; hay demasiados reportes pendientes, intenta más tarde'
      };
    }
    console.warn(`The bridge responded with HTTP ${res.status}`);
    return { mode: 'github-error', ok: false, message: 'Guardado localmente (el puente rechazó el reporte)' };
  } catch (err) {
    console.warn('No connection to the bridge', err);
    return { mode: 'github-offline', ok: false, message: 'Guardado localmente (sin conexión al puente)' };
  }
}
