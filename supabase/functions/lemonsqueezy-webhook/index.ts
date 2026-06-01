import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LS_WEBHOOK_SECRET  = Deno.env.get('LEMONSQUEEZY_WEBHOOK_SECRET') ?? '';

/* Vérifie la signature HMAC-SHA256 du webhook Lemon Squeezy (en-tête X-Signature) */
async function verifySignature(rawBody: string, signature: string): Promise<boolean> {
  if (!LS_WEBHOOK_SECRET || !signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(LS_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  // Comparaison à temps constant
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/* Mappe le statut LS vers le plan PatchFlow */
function statusToPlan(status: string, endsAt: string | null): 'free' | 'pro' {
  switch (status) {
    case 'active':
    case 'on_trial':
      return 'pro';
    case 'cancelled':
      // Annulé mais encore valide jusqu'à ends_at
      if (endsAt && new Date(endsAt).getTime() > Date.now()) return 'pro';
      return 'free';
    case 'paused':
    case 'expired':
    case 'unpaid':
    default:
      return 'free';
  }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const rawBody = await req.text();
    const signature = req.headers.get('X-Signature') ?? '';

    if (!(await verifySignature(rawBody, signature))) {
      console.error('[ls-webhook] Signature invalide');
      return new Response('Invalid signature', { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const eventName: string = payload?.meta?.event_name ?? '';
    const customData = payload?.meta?.custom_data ?? {};
    const attr = payload?.data?.attributes ?? {};
    const subId = payload?.data?.id ?? null;

    // user_id transmis au checkout via custom_data
    const userId: string | null = customData.user_id ?? null;

    console.log('[ls-webhook] event:', eventName, '| user:', userId, '| status:', attr.status);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Événements d'abonnement
    if (eventName.startsWith('subscription_')) {
      if (!userId) {
        console.warn('[ls-webhook] Pas de user_id dans custom_data — ignoré');
        return new Response('No user_id', { status: 200 });
      }

      const status: string = attr.status ?? 'none';
      const endsAt: string | null = attr.ends_at ?? null;
      const plan = statusToPlan(status, endsAt);

      // Upsert de l'abonnement
      await sb.from('subscriptions').upsert({
        user_id: userId,
        ls_subscription_id: String(subId),
        ls_customer_id: attr.customer_id ? String(attr.customer_id) : null,
        ls_order_id: attr.order_id ? String(attr.order_id) : null,
        ls_variant_id: attr.variant_id ? String(attr.variant_id) : null,
        status,
        plan,
        card_brand: attr.card_brand ?? null,
        card_last_four: attr.card_last_four ?? null,
        renews_at: attr.renews_at ?? null,
        ends_at: endsAt,
        customer_portal_url: attr.urls?.customer_portal ?? null,
        update_payment_url: attr.urls?.update_payment_method ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'ls_subscription_id' });

      // Mise à jour du plan dans le profil
      await sb.from('profiles').update({ plan }).eq('id', userId);

      console.log('[ls-webhook] Profil mis à jour:', userId, '→', plan);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[ls-webhook]', err);
    return new Response('Error: ' + (err instanceof Error ? err.message : String(err)), { status: 500 });
  }
});
