import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.9';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LS_WEBHOOK_SECRET = Deno.env.get('LEMONSQUEEZY_WEBHOOK_SECRET') ?? '';
const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPPORT_EMAIL     = Deno.env.get('SUPPORT_EMAIL') ?? 'support@patchflow.fr';
const SMTP_HOST         = Deno.env.get('SMTP_HOST') ?? '';
const SMTP_PORT         = parseInt(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER         = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS         = Deno.env.get('SMTP_PASS') ?? '';

/* Transport SMTP via nodemailer — même méthode éprouvée que invite-member /
   send-support-email. */
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

const DAYS_BEFORE_PURGE = 20;

/* Vérifie la signature HMAC-SHA256 du webhook Lemon Squeezy */
async function verifySignature(rawBody: string, signature: string): Promise<boolean> {
  if (!LS_WEBHOOK_SECRET || !signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(LS_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
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
      if (endsAt && new Date(endsAt).getTime() > Date.now()) return 'pro';
      return 'free';
    case 'paused':
    case 'expired':
    case 'unpaid':
    default:
      return 'free';
  }
}

/* Envoie un email : Resend si RESEND_API_KEY est défini, sinon SMTP/nodemailer
   (chemin par défaut éprouvé, identique aux autres fonctions). Avant, cette
   fonction n'envoyait QUE via Resend et abandonnait silencieusement sans clé —
   du coup l'email d'avertissement « données supprimées dans 20 jours » (Pro→Free)
   n'était jamais envoyé alors que le reste du projet tourne sur SMTP. */
async function sendEmail(to: string, subject: string, html: string) {
  try {
    if (RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `PatchFlow <${SUPPORT_EMAIL}>`, to: [to], subject, html }),
      });
      if (!res.ok) console.error('[ls-webhook] Resend error', await res.text());
    } else if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      await transporter.sendMail({ from: `PatchFlow <${SMTP_USER}>`, to, subject, html });
    } else {
      console.warn('[ls-webhook] Aucun service email configuré (RESEND_API_KEY ou SMTP_* requis)');
    }
  } catch (e) {
    console.error('[ls-webhook] sendEmail failed', e);
  }
}

/* Email d'avertissement 20 jours avant suppression */
function buildWarningEmail(email: string, deleteDate: string): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:40px 0">
  <div style="max-width:540px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
    <div style="background:#0a0f1c;padding:28px 32px;text-align:center">
      <span style="font-size:22px;font-weight:800;color:#fff">Patch<span style="color:#ff6b1a">Flow</span></span>
    </div>
    <div style="padding:32px">
      <h2 style="font-size:20px;font-weight:700;margin:0 0 16px;color:#111">Votre abonnement Pro a été résilié</h2>
      <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 20px">
        Votre abonnement PatchFlow Pro a pris fin. Vous continuez d'accéder à votre compte en plan Gratuit (500&nbsp;Mo de stockage cloud).
      </p>
      <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px 20px;margin:0 0 24px">
        <strong style="color:#856404">⚠️ Action requise avant le ${deleteDate}</strong>
        <p style="color:#856404;font-size:14px;margin:8px 0 0;line-height:1.6">
          Votre espace cloud dépasse 500&nbsp;Mo. Les fichiers excédentaires seront <strong>automatiquement supprimés</strong> dans ${DAYS_BEFORE_PURGE}&nbsp;jours si votre espace n'est pas réduit ou si vous ne réactivez pas votre abonnement Pro.
        </p>
      </div>
      <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 24px">
        Pour éviter toute perte de données, vous pouvez&nbsp;:
      </p>
      <ul style="color:#555;font-size:14px;line-height:2;margin:0 0 28px;padding-left:20px">
        <li>Télécharger vos fichiers importants depuis l'onglet <strong>Fichiers</strong></li>
        <li>Supprimer des fichiers pour passer sous 500&nbsp;Mo</li>
        <li>Réactiver votre abonnement Pro pour conserver tous vos fichiers</li>
      </ul>
      <div style="text-align:center">
        <a href="https://patchflow.fr/app.html" style="display:inline-block;background:#ff6b1a;color:#fff;font-weight:700;font-size:15px;padding:13px 32px;border-radius:8px;text-decoration:none">
          Gérer mes fichiers
        </a>
      </div>
    </div>
    <div style="background:#f8f9fa;padding:16px 32px;text-align:center;font-size:12px;color:#999;border-top:1px solid #eee">
      PatchFlow — Votre espace de production sonore.<br>
      Des questions ? Répondez à cet e-mail ou contactez <a href="mailto:${SUPPORT_EMAIL}" style="color:#ff6b1a">${SUPPORT_EMAIL}</a>
    </div>
  </div>
</body>
</html>`;
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
    const userId: string | null = customData.user_id ?? null;

    console.log('[ls-webhook] event:', eventName, '| user:', userId, '| status:', attr.status);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (eventName.startsWith('subscription_')) {
      if (!userId) {
        console.warn('[ls-webhook] Pas de user_id dans custom_data — ignoré');
        return new Response('No user_id', { status: 200 });
      }

      const status: string = attr.status ?? 'none';
      const endsAt: string | null = attr.ends_at ?? null;
      const newPlan = statusToPlan(status, endsAt);

      // 1. Récupérer le plan actuel pour détecter la transition Pro → Free
      const { data: profile } = await sb
        .from('profiles')
        .select('plan, email, plan_override')
        .eq('id', userId)
        .maybeSingle();

      // Compte avec octroi manuel (plan_override=true) : on enregistre quand
      // même l'abonnement (utile si l'user paie un jour un vrai abonnement),
      // mais on NE TOUCHE PAS à profiles.plan — sinon un événement LS (retry,
      // relance, ancien abonnement expiré...) écraserait l'accès offert
      // manuellement en base.
      if (profile?.plan_override) {
        console.log('[ls-webhook] plan_override actif — profiles.plan non modifié pour', userId);
      }

      const wasProNowFree = !profile?.plan_override && profile?.plan === 'pro' && newPlan === 'free';
      const isNowPro      = newPlan === 'pro';

      // 2. Upsert abonnement
      await sb.from('subscriptions').upsert({
        user_id: userId,
        ls_subscription_id: String(subId),
        ls_customer_id: attr.customer_id ? String(attr.customer_id) : null,
        ls_order_id: attr.order_id ? String(attr.order_id) : null,
        ls_variant_id: attr.variant_id ? String(attr.variant_id) : null,
        status, plan: newPlan,
        card_brand: attr.card_brand ?? null,
        card_last_four: attr.card_last_four ?? null,
        renews_at: attr.renews_at ?? null,
        ends_at: endsAt,
        customer_portal_url: attr.urls?.customer_portal ?? null,
        update_payment_url: attr.urls?.update_payment_method ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'ls_subscription_id' });

      // 3. Mise à jour du plan dans le profil — sauf si octroi manuel actif
      if (!profile?.plan_override) {
        await sb.from('profiles').update({ plan: newPlan }).eq('id', userId);
      }

      // 4a. Pro → Free : planifier la suppression + envoyer l'email
      if (wasProNowFree) {
        const deleteDate = new Date(Date.now() + DAYS_BEFORE_PURGE * 24 * 60 * 60 * 1000);

        // Upsert pour éviter les doublons si l'event arrive plusieurs fois
        await sb.from('pending_data_deletions').upsert({
          user_id:    userId,
          scheduled_at: deleteDate.toISOString(),
          created_at:   new Date().toISOString(),
          executed_at:  null,
          cancelled_at: null,
        }, { onConflict: 'user_id' });

        // Email d'avertissement
        const userEmail = profile?.email ?? (attr.user_email ?? null);
        if (userEmail) {
          const deleteDateStr = deleteDate.toLocaleDateString('fr-FR', {
            day: 'numeric', month: 'long', year: 'numeric',
          });
          await sendEmail(
            userEmail,
            `⚠️ Vos données cloud PatchFlow seront supprimées le ${deleteDateStr}`,
            buildWarningEmail(userEmail, deleteDateStr),
          );
          // Marquer l'email comme envoyé
          await sb.from('pending_data_deletions')
            .update({ notified_at: new Date().toISOString() })
            .eq('user_id', userId);
        }
        console.log('[ls-webhook] Suppression planifiée pour', userId, 'le', deleteDate.toISOString());
      }

      // 4b. Resubscription Pro : annuler la suppression planifiée
      if (isNowPro) {
        const { data: pending } = await sb
          .from('pending_data_deletions')
          .select('id')
          .eq('user_id', userId)
          .is('executed_at', null)
          .is('cancelled_at', null)
          .maybeSingle();

        if (pending) {
          await sb.from('pending_data_deletions')
            .update({ cancelled_at: new Date().toISOString() })
            .eq('id', pending.id);
          console.log('[ls-webhook] Suppression annulée — user a resubscrit:', userId);
        }
      }

      console.log('[ls-webhook] Plan mis à jour:', userId, '→', newPlan);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[ls-webhook]', err);
    return new Response('Error: ' + (err instanceof Error ? err.message : String(err)), { status: 500 });
  }
});
