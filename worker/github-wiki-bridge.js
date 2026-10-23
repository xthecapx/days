/**
 * PUENTE ANÓNIMO ESTILO WIKIPEDIA PARA GITHUB PAGES (CLOUDFLARE WORKERS)
 *
 * En Cloudflare (Workers & Pages -> days -> Settings -> Variables and Secrets):
 * Agrega una variable llamada:
 *   GITHUB_TOKEN = tu token de GitHub (github_pat_... o ghp_...)
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
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Usa POST para actualizar incidents.json',
          hasGithubTokenConfigured: Boolean(env && env.GITHUB_TOKEN)
        }),
        {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Limpiar posibles espacios o comillas en el token y usar xthecapx/days por defecto
    const repo = ((env && env.GITHUB_REPO) || 'xthecapx/days').trim();
    const rawToken = ((env && env.GITHUB_TOKEN) || '').trim();
    const token = rawToken.replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Falta configurar la variable GITHUB_TOKEN en Cloudflare (Settings -> Variables and Secrets).'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    try {
      const body = await request.json();
      const { commitMessage, content } = body;

      if (!content || !Array.isArray(content.incidents)) {
        return new Response(JSON.stringify({ error: 'Formato inválido de incidents.json' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const apiUrl = `https://api.github.com/repos/${repo}/contents/data/incidents.json`;
      const ghHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Vecinos-Rio-Del-Hato-Anonymous-Wiki-Bot'
      };

      // 1. Obtener el SHA actual de data/incidents.json
      const currentRes = await fetch(apiUrl, { headers: ghHeaders });
      if (!currentRes.ok) {
        const errText = await currentRes.text();
        return new Response(
          JSON.stringify({
            ok: false,
            step: 'GET_SHA',
            tokenPrefix: token.slice(0, 7) + '...',
            error: errText
          }),
          {
            status: currentRes.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
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
        return new Response(JSON.stringify({ ok: false, step: 'PUT_COMMIT', error: errText }), {
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
