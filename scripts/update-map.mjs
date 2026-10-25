#!/usr/bin/env node
/**
 * Downloads the OpenStreetMap geometry for the game area and saves it to
 * data/map.json (lat/lng, independent of the grid). Usage: npm run map:update
 *
 * Manual adjustments live in data/map-overrides.json and are NOT touched here.
 * Data © OpenStreetMap contributors, ODbL license.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GEO_BOUNDS } from '../src/core/geo.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'map.json');

// The area is defined once, in src/core/geo.js (the map and the Worker use it too).
const BOUNDS = GEO_BOUNDS;

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

const bbox = `${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east}`;
const QUERY = `[out:json][timeout:90];(
  way["highway"](${bbox});
  way["waterway"](${bbox});
  way["natural"="water"](${bbox});
  way["landuse"](${bbox});
  way["leisure"~"park|garden|pitch|recreation_ground"](${bbox});
);out geom;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOverpass() {
  let lastError;
  for (let round = 0; round < 3; round++) {
    for (const url of SERVERS) {
      try {
        process.stdout.write(`→ ${url} … `);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'days-map-updater/1.0' },
          body: `data=${encodeURIComponent(QUERY)}`,
          signal: AbortSignal.timeout(120_000)
        });
        const text = await res.text();
        if (!res.ok || !text.startsWith('{')) throw new Error(`HTTP ${res.status} ${text.slice(0, 60)}`);
        console.log('ok');
        return JSON.parse(text);
      } catch (err) {
        lastError = err;
        console.log(`failed (${err.message})`);
      }
    }
    await sleep(4000 * (round + 1));
  }
  throw lastError;
}

const ROAD_CLASS = {
  trunk: 'highway',
  trunk_link: 'highway',
  motorway: 'highway',
  motorway_link: 'highway',
  primary: 'collector',
  primary_link: 'collector',
  secondary: 'collector',
  secondary_link: 'collector',
  tertiary: 'collector',
  tertiary_link: 'collector',
  unclassified: 'arterial',
  residential: 'minor',
  living_street: 'minor',
  service: 'local',
  track: 'dirt',
  busway: 'busway',
  footway: 'trail',
  path: 'trail',
  pedestrian: 'trail',
  steps: 'trail',
  cycleway: 'trail',
  bridleway: 'trail'
};

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const line = (geometry) => geometry.map((g) => [round6(g.lat), round6(g.lon)]);

function convert(osm) {
  const out = { roads: [], water: [], areas: [], waterBodies: [] };
  for (const el of osm.elements) {
    const t = el.tags || {};
    if (!el.geometry || el.geometry.length < 2) continue;
    const pts = line(el.geometry);

    if (t.highway) {
      const cls = ROAD_CLASS[t.highway];
      if (!cls || t.highway === 'corridor') continue;
      out.roads.push({
        id: el.id,
        cls,
        name: t.name || null,
        bridge: Boolean(t.bridge && t.bridge !== 'no'),
        tunnel: Boolean(t.tunnel && t.tunnel !== 'no'),
        oneway: t.oneway === 'yes',
        pts
      });
    } else if (t.waterway) {
      out.water.push({ id: el.id, kind: t.waterway, name: t.name || null, pts });
    } else if (t.natural === 'water' || t.landuse === 'basin') {
      out.waterBodies.push({ id: el.id, name: t.name || null, pts });
    } else if (t.landuse || t.leisure) {
      out.areas.push({ id: el.id, kind: t.landuse || t.leisure, name: t.name || null, pts });
    }
  }
  return out;
}

const osm = await fetchOverpass();
const data = {
  attribution: '© OpenStreetMap contributors (ODbL)',
  generatedAt: new Date().toISOString(),
  bounds: BOUNDS,
  ...convert(osm)
};

fs.writeFileSync(OUT, JSON.stringify(data));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(
  `✔ data/map.json (${kb} KB): ${data.roads.length} roads, ${data.water.length} waterways, ` +
    `${data.waterBodies.length} water bodies, ${data.areas.length} areas`
);
