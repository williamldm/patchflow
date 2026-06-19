import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import JSZip from 'https://esm.sh/jszip@3.10.1';

/* ════════════════════════════════════════════════════════════════════
   INPUTLIST-AI — "Mode IA" de l'input list (réservé Pro).
   On reçoit un document décrivant une liste de canaux (input list / patch
   list / rider) sous différents formats — image, PDF, CSV/texte, Word —
   et on demande à un modèle vision/texte via OpenRouter (sortie structurée
   JSON Schema) de le convertir en une liste de canaux prêts à insérer.
   La clé API reste côté serveur (secret OPENROUTER_API_KEY).
   ════════════════════════════════════════════════════════════════════ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const MODEL = 'google/gemini-2.5-flash';

/* Pieds de micro reconnus — DOIVENT rester alignés avec la datalist
   #il-note-list dans app.html (champ "note" de l'input list). */
const STANDS = ['Grand pied', 'Petit pied', 'Embase ronde', 'Pied de table', 'Pince', 'Perche'];

const SYSTEM = `Tu es un assistant qui numérise des input lists (listes de canaux / patch lists) pour des ingénieurs du son.
On te fournit un document (photo, scan, PDF, tableau Excel/CSV, ou texte Word) décrivant les canaux d'entrée d'un concert. Tu dois identifier chaque canal et le restituer sous forme de liste d'objets structurés.

RÈGLES :
- Un objet par canal/voie, dans l'ordre du document (de haut en bas).
- short_name : nom court en MAJUSCULES, ≤ 8 caractères (ex. "KICK", "SNRT", "VOX", "BASS"). Déduis-le du nom long si absent.
- long_name : nom complet du canal (ex. "Grosse caisse", "Caisse claire top", "Lead Vox", "Basse DI").
- source : la famille/instrument source si indiquée (ex. "Batterie", "Basse", "Guitare", "Claviers", "Chant", "Percussions"). Vide si inconnue.
- mic : le modèle exact de micro ou de DI s'il figure dans le document (ex. "SM57", "Beta 52A", "AKG 414", "Radial JDI", "DI"). Vide si non précisé. N'invente jamais un modèle qui n'est pas écrit.
- gain : nombre (dB) uniquement s'il est explicitement écrit, sinon 0.
- phantom : true si une alimentation fantôme +48V est indiquée pour ce canal (colonne "48V", "+48", "P48", "phantom" cochée), sinon false.
- iem_group : groupe / mix d'oreillette (IEM) si indiqué, sinon vide.
- note : utilise ce champ pour le PIED de micro si le document en mentionne un. Valeurs préférées (choisis la plus proche) : ${STANDS.join(', ')}. Sinon, recopie une éventuelle remarque courte. Vide si rien.

IMPORTANT :
- Ne renvoie QUE les canaux réellement présents dans le document. N'ajoute pas de canaux "par défaut".
- Ne déduis le +48V que s'il est explicitement marqué : ne l'active pas "au cas où".
- Si le document est illisible ou ne contient aucune liste de canaux, renvoie une liste vide.`;

/* JSON Schema strict (compatible OpenAI/OpenRouter). */
const SCHEMA = {
  type: 'object',
  properties: {
    channels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          short_name: { type: 'string' },
          long_name: { type: 'string' },
          source: { type: 'string' },
          mic: { type: 'string' },
          gain: { type: 'number' },
          phantom: { type: 'boolean' },
          iem_group: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['short_name', 'long_name', 'source', 'mic', 'gain', 'phantom', 'iem_group', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['channels'],
  additionalProperties: false,
};

const PROMPT = "Numérise cette input list : liste tous les canaux présents avec leur nom court, nom long, source, micro/DI, +48V, IEM et pied de micro.";

/* Extrait le texte brut d'un .docx (zip → word/document.xml → tags retirés). */
async function docxToText(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const zip = await JSZip.loadAsync(bytes);
  const doc = zip.file('word/document.xml');
  if (!doc) return '';
  const xml = await doc.async('string');
  return xml
    .replace(/<\/w:p>/g, '\n')          // fin de paragraphe → saut de ligne
    .replace(/<w:tab[^>]*\/>/g, '\t')   // tabulations
    .replace(/<[^>]+>/g, '')            // tous les autres tags
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (!OPENROUTER_API_KEY) {
      return json({ error: "Le service IA n'est pas configuré (clé API manquante côté serveur)." }, 503);
    }

    /* ── Auth ── */
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Non autorisé' }, 401);
    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
    );
    const { data: { user }, error: authErr } = await sbAdmin.auth.getUser();
    if (authErr || !user) return json({ error: 'Non autorisé' }, 401);

    /* ── Réservé au plan Pro (vérifié côté serveur, non contournable) ── */
    const { data: prof } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    ).from('profiles').select('plan').eq('id', user.id).maybeSingle();
    if (!prof || prof.plan !== 'pro') {
      return json({ error: 'Fonctionnalité réservée au plan Pro.', code: 'pro_only' }, 403);
    }

    /* ── Lecture du payload : { kind, ... } ── */
    const body = await req.json() as {
      kind?: string; imageBase64?: string; mediaType?: string; base64?: string; text?: string;
    };
    const kind = body.kind || '';

    /* Contenu utilisateur + éventuels plugins (PDF) selon le format reçu. */
    let userContent: unknown;
    let plugins: unknown[] | undefined;

    if (kind === 'image') {
      const mediaType = body.mediaType || '';
      const data = body.imageBase64 || '';
      const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
      if (!ALLOWED.has(mediaType)) return json({ error: "Format d'image non supporté." }, 400);
      if (!data || data.length < 100) return json({ error: 'Image manquante ou vide.' }, 400);
      if (data.length > 7_300_000) return json({ error: 'Fichier trop lourd (max ~5 Mo).' }, 413);
      userContent = [
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } },
        { type: 'text', text: PROMPT },
      ];
    } else if (kind === 'pdf') {
      const data = body.base64 || '';
      if (!data || data.length < 100) return json({ error: 'PDF manquant ou vide.' }, 400);
      if (data.length > 14_000_000) return json({ error: 'Fichier trop lourd (max ~10 Mo).' }, 413);
      userContent = [
        { type: 'file', file: { filename: 'inputlist.pdf', file_data: `data:application/pdf;base64,${data}` } },
        { type: 'text', text: PROMPT },
      ];
      plugins = [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }];
    } else if (kind === 'docx') {
      const data = body.base64 || '';
      if (!data || data.length < 100) return json({ error: 'Document manquant ou vide.' }, 400);
      if (data.length > 14_000_000) return json({ error: 'Fichier trop lourd (max ~10 Mo).' }, 413);
      let text = '';
      try { text = await docxToText(data); }
      catch { return json({ error: 'Document Word illisible.' }, 400); }
      if (!text || text.length < 10) return json({ error: 'Aucun texte trouvé dans le document Word.' }, 400);
      userContent = `${PROMPT}\n\n--- Contenu du document ---\n${text.slice(0, 60_000)}`;
    } else if (kind === 'text') {
      const text = (body.text || '').trim();
      if (text.length < 5) return json({ error: 'Fichier texte vide.' }, 400);
      userContent = `${PROMPT}\n\n--- Contenu du fichier ---\n${text.slice(0, 60_000)}`;
    } else {
      return json({ error: 'Format de fichier non pris en charge.' }, 400);
    }

    /* ── Appel OpenRouter : sortie structurée (format OpenAI) ── */
    const reqBody: Record<string, unknown> = {
      model: MODEL,
      max_tokens: 8000,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'input_list', strict: true, schema: SCHEMA },
      },
    };
    if (plugins) reqBody.plugins = plugins;

    const aiResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://patchflow.app',
        'X-Title': 'PatchFlow Input List AI',
      },
      body: JSON.stringify(reqBody),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text().catch(() => '');
      console.error('[inputlist-ai] OpenRouter error', aiResp.status, txt);
      const friendly = aiResp.status === 429
        ? 'Service IA momentanément surchargé, réessayez dans un instant.'
        : `IA ${aiResp.status}: ${txt.slice(0, 200)}`;
      return json({ error: friendly }, 502);
    }

    const aiJson = await aiResp.json();
    const content = aiJson.choices?.[0]?.message?.content;
    if (!content) return json({ error: 'Réponse IA vide.' }, 502);

    let parsed: { channels?: unknown[] };
    try { parsed = JSON.parse(content); }
    catch { return json({ error: 'Réponse IA illisible.' }, 502); }

    /* ── Re-validation serveur : ne renvoyer que des canaux propres ── */
    const STAND_SET = new Set(STANDS.map((s) => s.toLowerCase()));
    const channels = (Array.isArray(parsed.channels) ? parsed.channels : [])
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .slice(0, 200)
      .map((c) => {
        const noteRaw = String(c.note ?? '').trim();
        /* Normalise le pied vers la casse de référence si reconnu. */
        const matchStand = STANDS.find((s) => s.toLowerCase() === noteRaw.toLowerCase());
        return {
          short_name: String(c.short_name ?? '').toUpperCase().replace(/\s+/g, '').slice(0, 10),
          long_name: String(c.long_name ?? '').slice(0, 80),
          source: String(c.source ?? '').slice(0, 40),
          mic: String(c.mic ?? '').slice(0, 40),
          gain: Number.isFinite(Number(c.gain)) ? Math.max(-20, Math.min(60, Number(c.gain))) : 0,
          phantom: c.phantom === true,
          iem_group: String(c.iem_group ?? '').slice(0, 20),
          note: matchStand || noteRaw.slice(0, 60),
        };
      })
      .filter((c) => c.short_name || c.long_name);

    return json({ ok: true, channels, count: channels.length });

  } catch (e) {
    console.error('[inputlist-ai]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
