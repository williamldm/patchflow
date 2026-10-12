import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.9';
import { renderEmail, p, quote, details } from '../_shared/email.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SMTP_HOST      = Deno.env.get('SMTP_HOST')      ?? '';
const SMTP_PORT      = parseInt(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER      = Deno.env.get('SMTP_USER')      ?? '';
const SMTP_PASS      = Deno.env.get('SMTP_PASS')      ?? '';
const SUPPORT_EMAIL  = Deno.env.get('SUPPORT_EMAIL')  ?? 'support@patchflow.fr';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

const MAX_PER_DAY = 3;

/* Transport SMTP via nodemailer — MÊME méthode que invite-member, qui délivre
   de façon fiable vers des domaines externes (gmail, yahoo, etc.). L'ancien
   SMTP fait-main échouait silencieusement sur le relay externe → le client
   ne recevait jamais sa confirmation. */
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  /* Certificat vérifié (Let's Encrypt, valide pour mail.patchflow.fr et
     patchflow.fr) : sans vérification, une interception pouvait récupérer
     le mot de passe SMTP et le contenu des emails (liens de connexion…). */
  tls: { minVersion: 'TLSv1.2' },
});

/* Journal des envois (table email_log, lue par l'onglet E-mails de l'administration). Jamais le corps,
   jamais de lien : le type, le destinataire masqué, l'objet et le résultat. Sans effet si la table manque. */
async function logEmail(source: string, kind: string, to: string, subject: string, err?: unknown) {
  try {
    const at = to.indexOf('@');
    const masked = at > 1 ? to[0] + '***' + to.slice(at) : '***' + to.slice(Math.max(at, 0));
    await createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
      .from('email_log').insert({
        source, kind: String(kind || 'inconnu').slice(0, 60), to_masked: masked, subject: String(subject || '').slice(0, 160),
        status: err ? 'failed' : 'sent', error: err ? String((err as Error)?.message ?? err).slice(0, 300) : null,
      });
  } catch { /* le journal ne doit jamais empêcher un envoi */ }
}

/* Email via Resend API (optionnel) — utilisé seulement si RESEND_API_KEY est
   défini ; sinon on passe par nodemailer/SMTP (chemin par défaut, éprouvé). */
async function sendEmailResend(to: string, subject: string, mail: { html: string; text: string }, replyTo?: string): Promise<void> {
  const fromEmail = SMTP_USER || 'noreply@patchflow.fr';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `PatchFlow <${fromEmail}>`, to: [to], subject, ...mail, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

async function sendEmail(to: string, subject: string, mail: { html: string; text: string }, replyTo?: string): Promise<void> {
  try {
    if (RESEND_API_KEY) {
      await sendEmailResend(to, subject, mail, replyTo);
    } else if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      await transporter.sendMail({ from: `PatchFlow <${SMTP_USER}>`, to, subject, ...mail, ...(replyTo ? { replyTo } : {}) });
    } else {
      throw new Error('Aucun service email configuré (RESEND_API_KEY ou SMTP_* requis)');
    }
  } catch (e) { await logEmail('send-support-email', 'support', to, subject, e); throw e; }
  await logEmail('send-support-email', 'support', to, subject);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non autorisé' }, 401);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) return json({ error: 'Non autorisé' }, 401);

    const body = await req.json();
    const { subject, message, userName } = body as { subject?: string; message?: string; userName?: string };

    if (!message?.trim()) {
      return json({ error: 'Message requis' }, 400);
    }
    const subjectSafe = (subject || 'Support PatchFlow').slice(0, 200);
    const messageSafe = message.trim().slice(0, 5000);

    /* Rate limiting */
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await sb
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since);

    if ((count ?? 0) >= MAX_PER_DAY) {
      return json({ error: `Limite atteinte : max ${MAX_PER_DAY} messages par 24h.` }, 429);
    }

    /* Save ticket en base */
    const { error: insertErr } = await sb.from('support_tickets').insert({
      user_id: user.id,
      user_email: user.email,
      user_name: userName || user.user_metadata?.full_name || '',
      subject: subjectSafe,
      message: messageSafe,
    });
    if (insertErr) {
      console.error('insert ticket:', insertErr);
      // Non bloquant : on continue l'envoi même si la DB échoue
    }

    // Échappement HTML pour empêcher l'injection de markup/liens (phishing) dans les emails
    const esc = (s: string) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const displayNameRaw = userName || user.user_metadata?.full_name || user.email || 'Utilisateur';
    const displayName  = esc(displayNameRaw);
    const subjectHtml  = esc(subjectSafe);
    const messageHtml  = esc(messageSafe);
    const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

    /* Accusé de réception */
    const userMail = renderEmail({
      tag: 'Support', title: 'Nous avons bien reçu votre message', preheader: `Réponse sous 24 à 48 heures ouvrées : « ${subjectHtml} »`,
      body: p(`Bonjour ${displayName},`) +
        p('Merci de nous avoir écrit. Votre demande est enregistrée et nous vous répondrons sous 24 à 48&nbsp;heures ouvrées, à cette adresse.') +
        details([['Sujet', subjectHtml], ['Envoyé le', esc(now)]]) +
        quote('Votre message', messageHtml) +
        p('Pour ajouter une précision ou une capture d\'écran, répondez simplement à cet e-mail.'),
      reason: 'Cet accusé de réception fait suite au message envoyé depuis l\'aide de PatchFlow.',
    });

    /* Notification de l'équipe : répondre à l'e-mail répond directement à l'utilisateur */
    const teamMail = renderEmail({
      tag: 'Nouveau ticket', title: subjectHtml, preheader: `${displayName} · ${esc(user.email ?? '')}`,
      body: details([['De', displayName], ['E-mail', `<a href="mailto:${esc(user.email ?? '')}" style="color:#e8590c">${esc(user.email ?? '')}</a>`], ['Reçu le', esc(now)], ['Compte', esc(user.id)]]) +
        quote('Message', messageHtml),
      cta: { label: 'Répondre', url: `mailto:${encodeURIComponent(user.email ?? '')}?subject=${encodeURIComponent('Re: ' + subjectSafe)}` },
      reason: 'Ticket envoyé depuis le formulaire d\'aide de l\'app. Répondre à cet e-mail écrit directement à l\'utilisateur.',
    });

    /* 1. Notification équipe support (domaine interne) */
    let teamOk = false;
    try {
      await sendEmail(SUPPORT_EMAIL, `[Support] ${subjectSafe} — ${displayNameRaw} (${user.email})`, teamMail, user.email ?? undefined);
      teamOk = true;
    } catch (teamErr) {
      console.error('[send-support-email] Notification support échouée:', teamErr instanceof Error ? teamErr.message : teamErr);
    }

    /* 2. Confirmation au client (même transport nodemailer/SMTP éprouvé) */
    let clientOk = false;
    try {
      await sendEmail(user.email!, `Votre demande au support PatchFlow : ${subjectSafe}`, userMail, SUPPORT_EMAIL);
      clientOk = true;
    } catch (emailErr) {
      console.error('[send-support-email] Confirmation client échouée:', emailErr instanceof Error ? emailErr.message : emailErr);
    }

    return json({ ok: true, teamOk, clientOk });

  } catch (e) {
    console.error('[send-support-email]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
