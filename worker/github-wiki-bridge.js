/**
 * PUENTE ANÓNIMO ESTILO WIKIPEDIA PARA GITHUB PAGES (100% GRATUITO EN CLOUDFLARE WORKERS)
 *
 * ¿Qué hace este archivo?
 * Permite que cualquier vecino en tu página de GitHub Pages agregue o edite un incidente en
 * `data/incidents.json` sin tener cuenta de GitHub y SIN guardar su dirección IP.
 *
 * Variables de entorno en Cloudflare Workers (Settings -> Variables):
 * - GITHUB_TOKEN: Fine-grained Personal Access Token con permiso "Contents: Read and Write" solo para este repositorio.
 * - GITHUB_REPO:  "tu-usuario/days"
 */

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Usa POST para actualizar incidents.json' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // IMPORTANTE: No leemos ni almacenamos CF-Connecting-IP ni X-Forwarded-For para garantizar 100% anonimato
    try {
      const body = await request.json();
      const { commitMessage, content } = body;

      if (!content || !Array.isArray(content.incidents)) {
        return new Response(JSON.stringify({ error: 'Formato inválido de incidents.json' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const apiUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/data/incidents.json`;
      const ghHeaders = {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Vecinos-Rio-Del-Hato-Anonymous-Wiki-Bot'
      };

      // 1. Obtener el SHA actual de data/incidents.json
      const currentRes = await fetch(apiUrl, { headers: ghHeaders });
      const currentFile = await currentRes.json();

      // 2. Codificar el nuevo JSON en Base64 UTF-8 y crear el commit anónimo
      const jsonText = JSON.stringify(content, null, 2) + '\n';
      const bytes = new TextEncoder().encode(jsonText);
      let binary = '';
      bytes.forEach((b) => (binary += String.fromCharCode(b)));
      const base64Content = btoa(binary);

      const updateRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage || 'Actualización vecinal anónima en incidents.json',
          content: base64Content,
          sha: currentFile.sha,
          committer: {
            name: 'Vecinos Río del Hato (Anónimo)',
            email: 'anonimo@vecinos-rio-del-hato.local'
          }
        })
      });

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        return new Response(JSON.stringify({ ok: false, error: errText }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
