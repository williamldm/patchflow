import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ════════════════════════════════════════════════════════════════════
   STAGE-AI — "Mode IA" du plan de scène (réservé Pro).
   On reçoit l'image d'un plan de scène (photo, croquis, PDF aplati en
   image…) et on demande à Gemini (vision + sortie structurée) de la
   convertir en une liste d'éléments plaçables dans l'éditeur BandPlan.
   La clé API reste côté serveur (secret GEMINI_API_KEY).
   ════════════════════════════════════════════════════════════════════ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const MODEL = 'gemini-2.0-flash';

/* Catalogue des éléments disponibles dans l'éditeur (type → libellé FR).
   DOIT rester aligné avec CATS dans app.html. */
const CATALOG: Record<string, string> = {
  kick: 'Grosse caisse', snare: 'Caisse claire', hihat: 'Charleston', toms: 'Toms',
  cymbal: 'Cymbale', kit: 'Kit batterie complet', cajon: 'Cajon',
  elec: 'Guitare électrique', acou: 'Guitare acoustique', bass_g: 'Basse',
  gamp: 'Ampli guitare', bamp: 'Ampli basse', cab: 'Baffle',
  keyboard: 'Clavier', piano: 'Piano', synth: 'Synthétiseur', wurly: 'Piano électrique',
  mic_s: 'Pied de micro (chant)', mic_hf: 'Micro HF', iem_p: 'Retour oreille (IEM)',
  trumpet: 'Trompette', trombone: 'Trombone', sax: 'Saxophone', horn: 'Cor / Tuba',
  timb: 'Timbales', conga: 'Congas', marimba: 'Marimba', xyl: 'Xylophone',
  foh: 'Console façade (FOH)', mon: 'Console retours (MON)', stagebox: 'Stage box',
  di: 'Boîte DI', iem_r: 'Rack IEM', spk: 'Enceinte', sub: 'Caisson de basse (sub)',
  wedge: 'Retour de scène (wedge)',
  chair: 'Chaise', stool: 'Tabouret', riser: 'Praticable', txt_bp: 'Texte libre',
};
const TYPES = Object.keys(CATALOG);

const SYSTEM = `Tu es un assistant qui numérise des plans de scène (stage plots) pour des techniciens du son.
On te fournit l'image d'un plan de scène (photo d'un croquis, plan imprimé, schéma…). Tu dois identifier chaque élément présent et le restituer sous forme de liste d'objets plaçables.

RÈGLES :
- Utilise UNIQUEMENT les types autorisés ci-dessous. Pour chaque élément du plan, choisis le type le plus proche. N'invente jamais un type qui n'existe pas.
- Coordonnées : repère de 2400 (largeur) × 1600 (hauteur). x va de 0 (côté cour / gauche scène) à 2400 (côté jardin / droite). y va de 0 (fond de scène / lointain) à 1600 (face / public). Place chaque élément à son CENTRE, en respectant les proportions et la disposition de l'image.
- label : un nom court en français (≤ 40 caractères) — reprends le texte écrit sur le plan s'il existe (ex. "Lead Vox", "Gtr 1", "Batterie Paul"), sinon déduis-le du type.
- Ne renvoie QUE les éléments réellement présents sur le plan. N'ajoute pas d'éléments "par défaut".
- Si le plan est illisible ou ne contient aucun élément reconnaissable, renvoie une liste vide.

TYPES AUTORISÉS (type = libellé) :
${TYPES.map((t) => `${t} = ${CATALOG[t]}`).join('\n')}`;

/* Gemini utilise un sous-ensemble d'OpenAPI 3.0 — pas d'additionalProperties */
const SCHEMA = {
  type: 'object',
  properties: {
    elements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: TYPES },
          x: { type: 'number' },
          y: { type: 'number' },
          label: { type: 'string' },
        },
        required: ['type', 'x', 'y', 'label'],
      },
    },
  },
  required: ['elements'],
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (!GEMINI_API_KEY) {
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

    /* ── Validation de l'image ── */
    const body = await req.json() as { imageBase64?: string; mediaType?: string };
    const mediaType = body.mediaType || '';
    const data = body.imageBase64 || '';
    const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    if (!ALLOWED.has(mediaType)) return json({ error: "Format d'image non supporté (PNG, JPEG, WEBP ou GIF)." }, 400);
    if (!data || data.length < 100) return json({ error: 'Image manquante ou vide.' }, 400);
    if (data.length > 7_300_000) return json({ error: 'Image trop lourde (max ~5 Mo).' }, 413);

    /* ── Appel Gemini : vision + sortie structurée (JSON Schema) ── */
    const aiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{
            parts: [
              { inlineData: { mimeType: mediaType, data } },
              { text: 'Numérise ce plan de scène : liste tous les éléments présents avec leur type, leur position (repère 2400×1600) et un label court.' },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: SCHEMA,
            maxOutputTokens: 4096,
          },
        }),
      },
    );

    if (!aiResp.ok) {
      const txt = await aiResp.text().catch(() => '');
      console.error('[stage-ai] Gemini error', aiResp.status, txt);
      const friendly = aiResp.status === 429
        ? 'Service IA momentanément surchargé, réessayez dans un instant.'
        : `Gemini ${aiResp.status}: ${txt.slice(0, 200)}`;
      return json({ error: friendly }, 502);
    }

    const aiJson = await aiResp.json();
    const textBlock = aiJson.candidates?.[0]?.content?.parts?.[0];
    if (!textBlock?.text) return json({ error: 'Réponse IA vide.' }, 502);

    let parsed: { elements?: unknown[] };
    try { parsed = JSON.parse(textBlock.text); }
    catch { return json({ error: 'Réponse IA illisible.' }, 502); }

    /* ── Re-validation serveur : ne renvoyer que des éléments propres ── */
    const VALID = new Set(TYPES);
    const elements = (Array.isArray(parsed.elements) ? parsed.elements : [])
      .filter((e): e is { type: string; x: number; y: number; label?: string } =>
        !!e && typeof e === 'object' && VALID.has((e as { type: string }).type))
      .slice(0, 120)
      .map((e) => ({
        type: e.type,
        x: clamp(Number(e.x) || 1200, 0, 2400),
        y: clamp(Number(e.y) || 800, 0, 1600),
        label: String(e.label ?? CATALOG[e.type] ?? e.type).slice(0, 40),
      }));

    return json({ ok: true, elements, count: elements.length });

  } catch (e) {
    console.error('[stage-ai]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
