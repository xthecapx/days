import { isLocalhost } from '../core/env.js';

/** Reads data/incidents.json from the repository: first GitHub (the latest approved), then the served file. */

async function getJson(url, label) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return await res.json();
    console.warn(`${label}: HTTP ${res.status}`);
  } catch (err) {
    console.warn(`${label}: could not load`, err);
  }
  return null;
}

/** null if there is no connection to either source. */
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
