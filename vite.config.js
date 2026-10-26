import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * `data/` stays at the repository root on purpose: the Worker and the live reading
 * (raw.githubusercontent.com/<repo>/main/data/incidents.json) depend on that path. That is why it does not go through
 * bundling: this plugin serves it in development and copies it as is to `dist/`. In addition, in development it
 * saves reports to `data/incidents.json` (what server.mjs used to do).
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_BODY = 1_000_000; // incidents.json weighs ~6 KB

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
        // The dev server is open to the network (to test from a phone), but this endpoint
        // writes to disk: it only accepts someone on THIS computer and pages from THIS server.
        if (!LOOPBACK.has(req.socket.remoteAddress)) return fail(403, 'Saving is only allowed from this computer');
        if (req.method !== 'POST') return fail(405, 'Use POST');
        // application/json forces the browser to ask permission (CORS) for other pages; text/plain does not.
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return fail(415, 'Expected application/json');
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return fail(403, 'Origin not allowed');

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY) {
            fail(413, 'File too large');
            req.destroy();
          }
        });
        req.on('end', () => {
          if (res.writableEnded) return;
          try {
            const parsed = JSON.parse(body);
            if (!parsed || !Array.isArray(parsed.incidents)) throw new Error('Invalid incidents.json format');
            fs.writeFileSync(path.join(root, 'data', 'incidents.json'), JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
            res.end(JSON.stringify({ ok: true, savedTo: 'data/incidents.json' }));
          } catch (err) {
            res.statusCode = err instanceof SyntaxError || /Invalid incidents\.json format/.test(err.message) ? 400 : 500;
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
 * Content security policy of the published site (GitHub Pages does not allow setting headers, so it goes in
 * a <meta>). Only own scripts and styles; the only outbound connections are the ones the app really uses. It is applied
 * only in the build: the dev server needs Vite's WebSocket.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://raw.githubusercontent.com https://days.xthecapx.workers.dev https://days-signal.xthecapx.workers.dev https://earthquake.usgs.gov https://www.seismicportal.eu",
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
  // Relative paths: the same build works at the root of a domain and in a GitHub Pages subdirectory.
  base: './',
  plugins: [dataAndLocalSave(), cspForBuild()],
  server: { port: 5173, host: true } // host: true = reachable from the phone on the same Wi-Fi network
});
