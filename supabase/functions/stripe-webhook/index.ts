/**
 * stripe-webhook — Reçoit les événements Stripe et tient à jour l'abonnement et le plan.
 *
 * À déployer SANS vérification de jeton (Stripe n'en envoie pas) :
 *   supabase functions deploy stripe-webhook --no-verify-jwt
 * L'authenticité vient de la signature « Stripe-Signature » (secret STRIPE_WEBHOOK_SECRET).
 *
 * Événements à cocher dans Stripe : customer.subscription.created / updated / deleted.
 * L'état fait foi côté Stripe : l'abonnement est relu par l'API avant d'être écrit, ce qui
 * absorbe les événements reçus dans le désordre.
 *
 * Reprise de la logique de lemonsqueezy-webhook : plan Pro / Gratuit, octroi manuel
 * (plan_override) respecté, passage Pro -> Gratuit = purge des fichiers excédentaires dans
 * 20 jours avec e-mail d'avertissement, annulée si l'abonné revient.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.9';

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_KEY          = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const RESEND_API_KEY      = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPPORT_EMAIL       = Deno.env.get('SUPPORT_EMAIL') ?? 'support@patchflow.fr';
const SMTP_HOST           = Deno.env.get('SMTP_HOST') ?? '';
const SMTP_PORT           = parseInt(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER           = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS           = Deno.env.get('SMTP_PASS') ?? '';
const DAYS_BEFORE_PURGE   = 20;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS }, tls: { minVersion: 'TLSv1.2' },
});

// <logic> — fonctions pures, essayées à part dans le navigateur (le code ci-dessous en reste séparé)
/* En-tête « t=…,v1=…,v1=… » -> { t, sigs } */
function parseSigHeader(header: string) {
  const out: { t: string; sigs: string[] } = { t: '', sigs: [] };
  String(header || '').split(',').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 0) return;
    const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
    if (k === 't') out.t = v; else if (k === 'v1') out.sigs.push(v);
  });
  return out;
}
/* Vérifie la signature d'un événement : HMAC-SHA256 de « t.corps », comparaison à temps constant,
   événement refusé s'il a plus de 5 minutes (rejeu) */
async function verifyStripe(raw: string, header: string, secret: string, nowSec: number) {
  if (!secret || !header) return false;
  const { t, sigs } = parseSigHeader(header);
  const ts = Number(t);
  if (!ts || !sigs.length || Math.abs(nowSec - ts) > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(t + '.' + raw)));
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((s) => {
    if (s.length !== hex.length) return false;
    let d = 0;
    for (let i = 0; i < hex.length; i++) d |= hex.charCodeAt(i) ^ s.charCodeAt(i);
    return d === 0;
  });
}
const iso = (sec: any) => (typeof sec === 'number' && sec > 0 ? new Date(sec * 1000).toISOString() : null);
/* Abonnement Stripe -> état PatchFlow. Vocabulaire commun avec l'ancien : active, on_trial, past_due,
   cancelled (résilié, valable jusqu'à ends_at), expired, unpaid, paused, incomplete. */
function normalizeSub(sub: any, nowMs: number) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0] ? sub.items.data[0] : {};
  /* La fin de période est sur l'abonnement (anciennes versions de l'API) ou sur ses lignes (récentes) */
  const periodEnd = typeof sub.current_period_end === 'number' ? sub.current_period_end : item.current_period_end;
  const cancelAt = typeof sub.cancel_at === 'number' ? sub.cancel_at : (sub.cancel_at_period_end ? periodEnd : null);
  let status = 'none', plan = 'free', endsAt: string | null = null, renewsAt: string | null = null;
  switch (sub.status) {
    case 'active':
    case 'trialing':
      if (cancelAt) { status = 'cancelled'; endsAt = iso(cancelAt); plan = cancelAt * 1000 > nowMs ? 'pro' : 'free'; }
      else { status = sub.status === 'trialing' ? 'on_trial' : 'active'; plan = 'pro'; renewsAt = iso(periodEnd); }
      break;
    case 'past_due': status = 'past_due'; plan = 'pro'; renewsAt = iso(periodEnd); break;   /* Stripe relance : l'accès est gardé */
    case 'canceled': status = 'expired'; endsAt = iso(sub.ended_at || sub.canceled_at); break;
    case 'unpaid': status = 'unpaid'; break;
    case 'paused': status = 'paused'; break;
    default: status = 'incomplete';                                                         /* incomplete, incomplete_expired */
  }
  return { status, plan, endsAt, renewsAt };
}
// </logic>

async function stripeGet(path: string) {
  if (!STRIPE_KEY) return null;
  try {
    const r = await fetch('https://api.stripe.com/v1' + path, { headers: { Authorization: 'Bearer ' + STRIPE_KEY } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function sendEmail(to: string, subject: string, html: string) {
  try {
    if (RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `PatchFlow <${SUPPORT_EMAIL}>`, to: [to], subject, html }),
      });
      if (!res.ok) console.error('[stripe-webhook] Resend error', await res.text());
    } else if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      await transporter.sendMail({ from: `PatchFlow <${SMTP_USER}>`, to, subject, html });
    } else {
      console.warn('[stripe-webhook] Aucun service e-mail configuré (RESEND_API_KEY ou SMTP_*)');
    }
  } catch (e) { console.error('[stripe-webhook] sendEmail', e); }
}

function buildWarningEmail(deleteDate: string): string {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:40px 0">
<div style="max-width:540px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
<div style="background:#0a0f1c;padding:28px 32px;text-align:center"><span style="font-size:22px;font-weight:800;color:#fff">Patch<span style="color:#ff6b1a">Flow</span></span></div>
<div style="padding:32px">
<h2 style="font-size:20px;font-weight:700;margin:0 0 16px;color:#111">Votre abonnement Pro a pris fin</h2>
<p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 20px">Vous gardez l'accès à votre compte en plan Gratuit (500&nbsp;Mo de stockage de fichiers).</p>
<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px 20px;margin:0 0 24px"><strong style="color:#856404">Action requise avant le ${deleteDate}</strong>
<p style="color:#856404;font-size:14px;margin:8px 0 0;line-height:1.6">Si votre espace dépasse 500&nbsp;Mo, les fichiers les plus anciens seront supprimés dans ${DAYS_BEFORE_PURGE}&nbsp;jours, jusqu'à repasser sous cette limite.</p></div>
<ul style="color:#555;font-size:14px;line-height:2;margin:0 0 28px;padding-left:20px">
<li>Téléchargez vos fichiers importants depuis l'onglet <strong>Fichiers</strong></li>
<li>Supprimez des fichiers pour passer sous 500&nbsp;Mo</li>
<li>Ou reprenez l'abonnement Pro pour tout conserver</li></ul>
<div style="text-align:center"><a href="https://patchflow.fr/app.html" style="display:inline-block;background:#ff6b1a;color:#fff;font-weight:700;font-size:15px;padding:13px 32px;border-radius:8px;text-decoration:none">Gérer mes fichiers</a></div>
</div>
<div style="background:#f8f9fa;padding:16px 32px;text-align:center;font-size:12px;color:#999;border-top:1px solid #eee">Une question&nbsp;? <a href="mailto:${SUPPORT_EMAIL}" style="color:#ff6b1a">${SUPPORT_EMAIL}</a></div>
</div></body></html>`;
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const raw = await req.text();
    if (!(await verifyStripe(raw, req.headers.get('Stripe-Signature') ?? '', STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000)))) {
      console.error('[stripe-webhook] signature invalide');
      return new Response('Invalid signature', { status: 401 });
    }
    const event = JSON.parse(raw);
    const type: string = event?.type ?? '';
    if (!type.startsWith('customer.subscription.')) return new Response(JSON.stringify({ ok: true, ignored: type }), { status: 200 });

    /* L'abonnement est relu chez Stripe : l'état courant, quel que soit l'ordre d'arrivée des événements */
    const evSub = event?.data?.object ?? {};
    const live = await stripeGet(`/subscriptions/${encodeURIComponent(evSub.id)}?expand[]=default_payment_method&expand[]=customer`);
    const sub = live && live.id === evSub.id ? live : evSub;
    if (!sub.id) return new Response('No subscription', { status: 200 });

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const customerId: string | null = typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null);

    /* Qui est l'abonné : métadonnée posée au paiement, sinon un abonnement déjà connu pour ce client Stripe */
    let userId: string | null = sub.metadata?.user_id ?? null;
    if (!userId && customerId) {
      const { data: known } = await sb.from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).limit(1).maybeSingle();
      userId = known?.user_id ?? null;
    }
    if (!userId) { console.warn('[stripe-webhook] abonnement sans user_id', sub.id); return new Response('No user_id', { status: 200 }); }

    const n = normalizeSub(sub, Date.now());
    const pm = sub.default_payment_method && typeof sub.default_payment_method === 'object' ? sub.default_payment_method : null;
    const card = pm?.card ?? null;
    const price = sub.items?.data?.[0]?.price?.id ?? null;

    const { data: profile } = await sb.from('profiles').select('plan, email, plan_override').eq('id', userId).maybeSingle();
    const wasProNowFree = !profile?.plan_override && profile?.plan === 'pro' && n.plan === 'free';

    await sb.from('subscriptions').upsert({
      user_id: userId,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerId,
      stripe_price_id: price,
      status: n.status, plan: n.plan,
      card_brand: card?.brand ?? null,
      card_last_four: card?.last4 ?? null,
      renews_at: n.renewsAt,
      ends_at: n.endsAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stripe_subscription_id' });

    /* Octroi manuel : l'abonnement est enregistré, le plan du profil n'est pas touché */
    if (!profile?.plan_override) await sb.from('profiles').update({ plan: n.plan }).eq('id', userId);

    if (wasProNowFree) {
      const deleteDate = new Date(Date.now() + DAYS_BEFORE_PURGE * 86400000);
      await sb.from('pending_data_deletions').upsert({
        user_id: userId, scheduled_at: deleteDate.toISOString(), created_at: new Date().toISOString(), executed_at: null, cancelled_at: null,
      }, { onConflict: 'user_id' });
      const to = profile?.email ?? (typeof sub.customer === 'object' ? sub.customer?.email : null) ?? null;
      if (to) {
        const when = deleteDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
        await sendEmail(to, `Vos fichiers PatchFlow au-delà de 500 Mo seront supprimés le ${when}`, buildWarningEmail(when));
        await sb.from('pending_data_deletions').update({ notified_at: new Date().toISOString() }).eq('user_id', userId);
      }
    }
    if (n.plan === 'pro') {
      const { data: pending } = await sb.from('pending_data_deletions').select('id').eq('user_id', userId).is('executed_at', null).is('cancelled_at', null).maybeSingle();
      if (pending) await sb.from('pending_data_deletions').update({ cancelled_at: new Date().toISOString() }).eq('id', pending.id);
    }
    console.log('[stripe-webhook]', type, userId, sub.status, '->', n.status, n.plan);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[stripe-webhook]', err);
    /* Stripe réessaie sur une erreur : on ne renvoie pas de détail */
    return new Response('Error', { status: 500 });
  }
});
