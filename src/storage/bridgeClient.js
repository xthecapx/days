/**
 * Envía un cambio al puente (Cloudflare Worker), que abre un Pull Request. Nada se publica hasta que
 * el dueño lo aprueba. Devuelve siempre un estado de sincronización legible; nunca lanza.
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
    console.warn(`El puente respondió HTTP ${res.status}`);
    return { mode: 'github-error', ok: false, message: 'Guardado localmente (el puente rechazó el reporte)' };
  } catch (err) {
    console.warn('Sin conexión al puente', err);
    return { mode: 'github-offline', ok: false, message: 'Guardado localmente (sin conexión al puente)' };
  }
}
