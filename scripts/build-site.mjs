#!/usr/bin/env node
/**
 * Arma la carpeta que se publica en GitHub Pages: solo lo que el navegador necesita.
 * Uso: node scripts/build-site.mjs [carpeta-de-salida]   (por defecto ./dist)
 *
 * Quedan fuera: worker/ (se despliega en Cloudflare), scripts/, tests/, .github/, assets/ y server.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Todo lo que `index.html` y `src/` leen en tiempo de ejecución. */
export const SITE_PATHS = ['index.html', 'src', 'data'];

export function buildSite(outDir = path.join(ROOT, 'dist')) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const rel of SITE_PATHS) {
    fs.cpSync(path.join(ROOT, rel), path.join(outDir, rel), { recursive: true });
  }
  return outDir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = buildSite(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`Sitio listo en ${out}`);
}
