/**
 * Cliente del servidor de la señal de ayuda. NUNCA lanza: siempre devuelve { ok: true, data } o
 * { ok: false, error, status? }, para que la pantalla decida qué mostrar sin try/catch por todos lados.
 *
 *   const api = createSignalApi({ baseUrl, room });
 *   const r = await api.state();          // lectura pública, no cuenta como oyente
 *   await api.poll({ listener, listening });
 *   await api.send({ lat, lng });
 *   await api.cancel({ id, token });
 */

const TIMEOUT_MS = 8000;

export function createSignalApi({ baseUrl, room = 'main', fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = TIMEOUT_MS } = {}) {
  const enabled = typeof baseUrl === 'string' && /^https?:\/\//.test(baseUrl);
  const base = enabled ? baseUrl.replace(/\/+$/, '') : '';

  async function request(path, { method = 'GET', body } = {}) {
    if (!enabled) return { ok: false, error: 'not_configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${path}${path.includes('?') ? '&' : '?'}room=${encodeURIComponent(room)}`, {
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* respuesta sin JSON (p. ej. una página de error de Cloudflare) */
      }
      if (res.ok && data?.ok) return { ok: true, data };
      return { ok: false, status: res.status, error: data?.code || (res.status === 429 ? 'rate_limited' : 'http_error'), message: data?.error };
    } catch (err) {
      return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    enabled,
    state: () => request('/state'),
    poll: ({ listener, listening }) => request('/poll', { method: 'POST', body: { listener, listening } }),
    send: ({ lat, lng }) => request('/signal', { method: 'POST', body: { lat, lng } }),
    cancel: ({ id, token }) => request('/signal/cancel', { method: 'POST', body: { id, token } })
  };
}
