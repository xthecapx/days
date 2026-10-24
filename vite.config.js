import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * `data/` se queda en la raíz del repositorio a propósito: el Worker y la lectura en vivo
 * (raw.githubusercontent.com/<repo>/main/data/incidents.json) dependen de esa ruta. Por eso no pasa por
 * el empaquetado: este plugin la sirve en desarrollo y la copia tal cual a `dist/`. Además, en desarrollo
 * guarda los reportes en `data/incidents.json` (lo que hacía server.mjs).
 */
function dataAndLocalSave() {
  let root;
  let outDir;
  return {
    name: 'data-and-local-save',
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/api/local-wiki-save', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end(JSON.stringify({ ok: false, error: 'Usa POST' }));
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (!parsed || !Array.isArray(parsed.incidents)) throw new Error('Formato inválido de incidents.json');
            fs.writeFileSync(path.join(root, 'data', 'incidents.json'), JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
            res.end(JSON.stringify({ ok: true, savedTo: 'data/incidents.json' }));
          } catch (err) {
            res.statusCode = err instanceof SyntaxError || /inválido/.test(err.message) ? 400 : 500;
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
      });
    },
    closeBundle() {
      fs.cpSync(path.join(root, 'data'), path.join(outDir, 'data'), { recursive: true });
    }
  };
}

export default defineConfig({
  // Rutas relativas: el mismo build funciona en la raíz de un dominio y en un subdirectorio de GitHub Pages.
  base: './',
  plugins: [dataAndLocalSave()],
  server: { port: 5173, host: true } // host: true = accesible desde el celular en la misma red Wi-Fi
});
