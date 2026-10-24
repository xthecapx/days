/** Solo en desarrollo: server.mjs escribe el JSON en data/incidents.json. Devuelve true si se guardó. */
export async function saveToDisk(data) {
  try {
    const res = await fetch('/api/local-wiki-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (err) {
    console.warn('No se pudo guardar en disco (¿corre npm run dev?)', err);
    return false;
  }
}
