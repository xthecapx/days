/** Development only: server.mjs writes the JSON to data/incidents.json. Returns true if it was saved. */
export async function saveToDisk(data) {
  try {
    const res = await fetch('/api/local-wiki-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (err) {
    console.warn('Could not save to disk (is npm run dev running?)', err);
    return false;
  }
}
