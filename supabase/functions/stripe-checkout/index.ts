/**
 * stripe-checkout — Paiement de l'abonnement Pro avec Stripe (remplace lemonsqueezy-checkout).
 *
 * Appelée par l'application avec le jeton de l'utilisateur. Actions :
 *   checkout  { variant: 'monthly' | 'yearly' }  -> { data: { url } }  Stripe Checkout hébergé
 *   portal    {}                                 -> { data: { status, plan, renews_at, ends_at, card_brand,
 *                                                   card_last_four, customer_portal_url } }
 *             Le portail client Stripe (factures, carte, résiliation) est créé à la demande : son
 *             adresse est à usage unique. Un abonné resté chez Lemon Squeezy reçoit les liens enregistrés.
 *
 * Secrets : STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY, SITE_URL (facultatif).
 * Le plan n'est JAMAIS accordé ici : c'est le webhook (stripe-webhook) qui écrit l'abonnement.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_KEY       = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const PRICE_MONTHLY    = Deno.env.get('STRIPE_PRICE_MONTHLY') ?? '';
const PRICE_YEARLY     = Deno.env.get('STRIPE_PRICE_YEARLY') ?? '';
const SITE_URL         = (Deno.env.get('SITE_URL') ?? 'https://patchflow.fr').replace(/\/+$/, '');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* Corps « application/x-www-form-urlencoded » imbriqué, comme l'attend l'API Stripe */
function form(obj: Record<string, unknown>, prefix = '', out: string[] = []): string {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? form(x as Record<string, unknown>, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`)));
    else if (typeof v === 'object') form(v as Record<string, unknown>, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}
async function stripe(path: string, params: Record<string, unknown>) {
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(params),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function getUser(req: Request) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: { user }, error } = await sb.auth.getUser();
  return error ? null : user;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const user = await getUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: row } = await sb.from('subscriptions')
      .select('stripe_customer_id, status, plan, renews_at, ends_at, card_brand, card_last_four, customer_portal_url, update_payment_url')
      .eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();

    // ── Ouvrir une session de paiement ──
    if (body.action === 'checkout') {
      if (!STRIPE_KEY) return json({ error: 'Stripe non configuré.' }, 500);
      if (body.variant !== 'monthly' && body.variant !== 'yearly') return json({ error: 'Formule inconnue.' }, 400);
      const price = body.variant === 'yearly' ? PRICE_YEARLY : PRICE_MONTHLY;
      if (!price) return json({ error: 'Prix non configuré : ' + body.variant }, 500);
      /* Déjà abonné : pas de second abonnement */
      if (row && ['active', 'on_trial', 'past_due'].includes(String(row.status))) return json({ error: 'Vous avez déjà un abonnement actif.' }, 409);

      const r = await stripe('/checkout/sessions', {
        mode: 'subscription',
        line_items: [{ price, quantity: 1 }],
        success_url: SITE_URL + '/app.html?checkout=success',
        cancel_url: SITE_URL + '/app.html?checkout=cancel',
        client_reference_id: user.id,
        ...(row?.stripe_customer_id ? { customer: row.stripe_customer_id } : { customer_email: user.email }),
        subscription_data: { metadata: { user_id: user.id } },
        metadata: { user_id: user.id },
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
        locale: 'fr',
      });
      if (!r.ok || !r.data?.url) {
        console.error('[stripe-checkout] checkout', r.status, JSON.stringify(r.data?.error ?? r.data));
        return json({ error: 'Erreur Stripe : ' + (r.data?.error?.code ?? r.status) }, 502);
      }
      return json({ data: { url: r.data.url }, error: null });
    }

    // ── Portail client : factures, carte, résiliation ──
    if (body.action === 'portal') {
      if (row?.stripe_customer_id && STRIPE_KEY) {
        const r = await stripe('/billing_portal/sessions', { customer: row.stripe_customer_id, return_url: SITE_URL + '/app.html' });
        if (r.ok && r.data?.url) {
          return json({ data: { ...row, stripe_customer_id: undefined, customer_portal_url: r.data.url, update_payment_url: null }, error: null });
        }
        console.error('[stripe-checkout] portal', r.status, JSON.stringify(r.data?.error ?? r.data));
      }
      /* Abonné resté chez Lemon Squeezy, ou portail Stripe indisponible : ce qui est enregistré */
      return json({ data: row ? { ...row, stripe_customer_id: undefined } : null, error: null });
    }

    return json({ error: 'Action inconnue' }, 400);
  } catch (err) {
    console.error('[stripe-checkout]', err);
    return json({ error: 'Erreur serveur' }, 500);
  }
});
