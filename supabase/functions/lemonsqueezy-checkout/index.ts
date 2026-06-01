import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!;
const LS_API_KEY        = Deno.env.get('LEMONSQUEEZY_API_KEY') ?? '';
const LS_STORE_ID       = Deno.env.get('LEMONSQUEEZY_STORE_ID') ?? '';
const LS_VARIANT_MONTHLY = Deno.env.get('LEMONSQUEEZY_VARIANT_MONTHLY') ?? '';
const LS_VARIANT_YEARLY  = Deno.env.get('LEMONSQUEEZY_VARIANT_YEARLY') ?? '';
const SITE_URL          = Deno.env.get('SITE_URL') ?? 'https://patchflow.fr';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function getUser(req: Request) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: { user }, error } = await sb.auth.getUser();
  return error ? null : user;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const user = await getUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json();
    const { action } = body;

    // ── Créer une session de paiement ──
    if (action === 'checkout') {
      if (!LS_API_KEY || !LS_STORE_ID) return json({ error: 'Lemon Squeezy non configuré (API key / store).' }, 500);
      const variantKey = body.variant === 'yearly' ? 'yearly' : 'monthly';
      const variantId  = variantKey === 'yearly' ? LS_VARIANT_YEARLY : LS_VARIANT_MONTHLY;
      if (!variantId) return json({ error: 'Variante non configurée: ' + variantKey }, 500);

      const lsRes = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          'Authorization': 'Bearer ' + LS_API_KEY,
        },
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              checkout_data: {
                email: user.email,
                custom: { user_id: user.id },   // récupéré par le webhook
              },
              product_options: {
                redirect_url: SITE_URL + '/app.html?checkout=success',
                receipt_button_text: 'Retour à PatchFlow',
                receipt_thank_you_note: 'Merci ! Votre abonnement Pro est actif.',
              },
              checkout_options: { embed: false, dark: true },
            },
            relationships: {
              store:   { data: { type: 'stores',   id: String(LS_STORE_ID) } },
              variant: { data: { type: 'variants', id: String(variantId) } },
            },
          },
        }),
      });

      if (!lsRes.ok) {
        const t = await lsRes.text();
        console.error('[ls-checkout]', lsRes.status, t);
        return json({ error: 'Erreur Lemon Squeezy: ' + lsRes.status }, 500);
      }
      const data = await lsRes.json();
      const url = data?.data?.attributes?.url;
      return json({ data: { url }, error: null });
    }

    // ── Récupérer le lien du portail client (gestion abonnement / paiement) ──
    if (action === 'portal') {
      const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const { data: sub } = await sb.from('subscriptions')
        .select('customer_portal_url, update_payment_url, status, plan, renews_at, ends_at, card_brand, card_last_four')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return json({ data: sub || null, error: null });
    }

    return json({ error: 'Unknown action: ' + action }, 400);

  } catch (err) {
    console.error('[ls-checkout]', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
