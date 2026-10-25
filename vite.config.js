import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * `data/` se queda en la raíz del repositorio a propósito: el Worker y la lectura en vivo
 * (raw.githubusercontent.com/<repo>/main/data/incidents.json) dependen de esa ruta. Por eso no pasa por
 * el empaquetado: este plugin la sirve en desarrollo y la copia tal cual a `dist/`. Además, en desarrollo
 * guarda los reportes en `data/incidents.json` (lo que hacía server.mjs).
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_BODY = 1_000_000; // incidents.json pesa ~6 KB

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
        const fail = (status, error) => {
          res.statusCode = status;
          res.end(JSON.stringify({ ok: false, error }));
        };
        // El servidor de desarrollo queda abierto a la red (para probar desde el celular), pero este endpoint
        // escribe en disco: solo acepta a quien está en ESTE computador y a páginas de ESTE servidor.
        if (!LOOPBACK.has(req.socket.remoteAddress)) return fail(403, 'Solo se puede guardar desde este computador');
        if (req.method !== 'POST') return fail(405, 'Usa POST');
        // application/json obliga al navegador a pedir permiso (CORS) a otras páginas; text/plain no.
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return fail(415, 'Se esperaba application/json');
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return fail(403, 'Origen no permitido');

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY) {
            fail(413, 'Archivo demasiado grande');
            req.destroy();
          }
        });
        req.on('end', () => {
          if (res.writableEnded) return;
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

/**
 * Política de seguridad de contenido del sitio publicado (GitHub Pages no deja poner cabeceras, así que va en
 * un <meta>). Solo scripts y estilos propios; las únicas salidas son las que la app usa de verdad. Se aplica
 * solo en el build: el servidor de desarrollo necesita el WebSocket de Vite.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://raw.githubusercontent.com https://days.xthecapx.workers.dev https://days-signal.xthecapx.workers.dev",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join('; ');

const cspForBuild = () => ({
  name: 'csp-for-build',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n  <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
});

export default defineConfig({
  // Rutas relativas: el mismo build funciona en la raíz de un dominio y en un subdirectorio de GitHub Pages.
  base: './',
  plugins: [dataAndLocalSave(), cspForBuild()],
  server: { port: 5173, host: true } // host: true = accesible desde el celular en la misma red Wi-Fi
});
